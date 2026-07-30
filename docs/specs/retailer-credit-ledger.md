# Retailer credit & ledger — spec v1 (2026-07-30)

Bring each retailer's **outstanding balance** from Tally into the app (the way stock already arrives), show it where credit decisions actually get made, and give every retailer a **ledger page** — the retailer-side twin of the order detail page.

**Status: DESIGN DRAFT — owner review pending. Nothing built. Contains DB changes (new tables + RPCs) that need explicit owner approval at build time (prod-caution rule).**

Doctrine that frames everything below: **Tally is the accounting truth; the app is an operational mirror.** The app never computes a receivable — it displays Tally's number, timestamped, plus its own collections shown separately.

## The data reality (verified live, 2026-07-30)

| Fact | Consequence for this design |
|---|---|
| 622 retailers (599 active) | Bounded — a fetch-all + client filtering stays viable, like the other lists |
| **`tally_ledger_name` is EMPTY on all 622 rows** | The match key must be `name`, with `tally_ledger_name` as an optional override (D2) |
| **1 duplicate name** (`[shop redacted]` ×2) | An ambiguous key must update **nothing** — a naive match posts the same balance to two rows and double-counts money (D2) |
| 80 retailers have orders; 8 deposits exist (2 retailers) | Ledger pages must look right when nearly empty — empty states are the common case, not the edge case |
| Salesman RLS: **all active retailers**, but **own orders / own deposits only** | A salesman's ledger view is structurally partial — it must be labelled, or the page is staff-only (D7) |
| Money is integer paise everywhere | Tally's rupee decimals convert server-side, with a strict parse (D3) |

## D1 — Storage: a separate `retailer_credit` table, not columns on `retailers`

*Why not columns: (a) `retailers` RLS hands every salesman every active row, so a column is visible to everyone with no way to restrict it — RLS is row-level, not column-level; a separate table makes salesman visibility a policy decision instead of a fact (D7). (b) The shared `["retailers"]` query feeds the Quick Order picker — putting money there pushes money into more caches for no reason. (c) A sync then never touches identity fields (name/verified/active), so a bad import can't damage the retailer record. (d) Room to grow: as-of, limit, aging buckets.*

```
retailer_credit
  retailer_id        uuid  PK → retailers(id) on delete cascade
  outstanding_paise  bigint      not null   -- signed: + = they owe us, − = advance
  credit_limit_paise bigint      null       -- null = no limit known/set in Tally
  as_of              timestamptz not null   -- the snapshot's own timestamp
  source             text        not null   -- 'agent' | 'import'
  updated_at         timestamptz not null
```

One row per retailer, replaced wholesale each sync. **Absolute balances, never deltas** — that's what makes a re-run idempotent.

## D2 — Match key + the ambiguity rule

Key = `lower(regexp_replace(btrim(coalesce(nullif(btrim(tally_ledger_name),''), name)), '\s+', ' ', 'g'))`, with a functional index mirroring `products_tally_lower_idx`.

*Whitespace is collapsed, not just trimmed — measured 2026-07-30: **6 retailer names carry internal double spaces**, which would silently miss a Tally name spelled with single spaces. Collapsing fixes all six and adds **zero** new collisions (still exactly the one known pair). Punctuation is deliberately **not** stripped: today it would also add zero collisions, but it buys nothing and risks merging genuinely different shops later.*

*Reason: today every retailer's Tally identity IS its `name` (the column meant for it is empty). `tally_ledger_name` stays the escape hatch: once set on a row, it wins — so a shop can be renamed in the app without breaking the sync, and a Tally-side rename is fixed by filling one field instead of editing the shop's display name.*

**Ambiguity rule (this is the money-safety rule):** if a payload key matches **more than one** retailer, update **neither**, and report the key in a third bucket, `ambiguous`. Retailers get this stricter contract; the one known duplicate today lands in the bucket on day one, which is exactly how it gets fixed.

*Verified 2026-07-30 (not previously documented anywhere — established by execution, since the stock behaviour was only ever implied by its SQL): `import_stock`'s `UPDATE … FROM` join matches **every** row sharing the key, so a duplicate `tally_name` writes the same qty to all of them and reports them as N matched. `UNIQUE (brand_id, tally_name)` only blocks **exact** duplicates within a brand — it is case/whitespace-sensitive while the import key is `lower(btrim(...))`, and it does not constrain across brands at all. Live catalog today: **0 duplicate keys across ~1390 products**, so this is latent, not active. Because Tally's own item names are unique, a shared `tally_name` means one product is mismapped and would inherit a **phantom stock figure** — so `import_stock` should adopt this same ambiguity rule (report, update neither) as a small follow-up. Retailers have **no** name constraint at all and one live duplicate, which is why the rule is mandatory here from day one.*

**Pre-sync cleanup (identified 2026-07-30, awaiting owner go):** Tally enforces unique ledger names, so every collision is app-side. The single live collision is a **ghost + real pair of the same shop**: `[shop redacted]` exists twice — one row from the 2026-07-07 bulk import (no area, no phone, **0 orders, 0 deposits**) and one created 2026-07-23 with area Dipka, phone [phone redacted] and **1 order**. Deactivating the ghost row orphans nothing and clears the ambiguity before the first sync. One-row prod change → owner approval required.

## D3 — Ingestion: two paths, mirroring stock exactly

| Path | Function | Gate | Trigger |
|---|---|---|---|
| Manual | `import_credit(p_rows jsonb)` | `auth_profile_role() = 'admin'` | Excel/CSV wizard on the Retailers page (reuse the `StockImportWizard` shell verbatim) |
| Automated | `import_credit_agent(p_secret, p_rows)` | sha256 vs `agent_config` row `name='credit_push'` — **its own secret, not stock's** | The existing VPS Tally agent, second report |

Both share one set-based `UPDATE`/upsert in a single pass with the same CTE shape as `import_stock` — *the 20260719194611 lesson: the per-row loop timed out at 2000 rows; set-based ran 18ms.* Both return `{matched, unmatched[], ambiguous[]}`.

**Payload row:** `{ ledger_name, outstanding, credit_limit? }` — amounts as **rupees** (what Tally exports), converted to paise server-side.
- Accept `^-?[0-9]{1,12}(\.[0-9]{1,2})?$` after stripping commas; **anything else is rejected as a bad row, never coerced to 0** *(a silently-zeroed balance reads as "this shop is clear" — the most dangerous possible wrong answer here)*.
- **Sign convention: positive = the retailer owes us; negative = advance held.** Tally's Dr/Cr suffix is normalized by the agent; the RPC takes a signed number.
- Missing `credit_limit` leaves the existing value untouched (a balances-only feed never wipes limits).

## D4 — Freshness, and the two-sources-of-truth rule

The app knows about collections Tally may not have booked yet. **Never merge the two numbers into one.** Display the arithmetic:

```
Outstanding      ₹1,24,500     as of today 6:05 am
Collected since  − ₹15,000     2 receipts in the app
Effective        = ₹1,09,500   estimate
```

Rule: the "collected since" line counts **only non-voided deposits created after `as_of`**. It is self-correcting — once the office books those receipts in Tally, the next snapshot absorbs them and the line resets to zero. Voiding a deposit moves it back.

*Known limitation, stated rather than hidden: a receipt taken **before** the snapshot but not yet booked in Tally makes the outstanding read high. The app cannot detect that, which is exactly why the estimate is labelled and the authoritative number keeps its own line and timestamp.*

**Staleness:** `as_of` older than 36 h → amber "stale" chip. Older than 7 days → red, and the effective line is **hidden** (too far gone to estimate honestly).

## D5 — Placement map (where credit shows up)

1. **Retailer picker** (Quick Order + deposit flow) — **the balance rides every row**, as a secondary muted line under the shop name (owner call 2026-07-30, overriding this spec's earlier "confirmation card only" recommendation — *the salesman standing in the shop is exactly who the number is for, and hiding it until commitment is one tap too late*). The row goes two-line, matching the Products page grammar:

   ```
   Sharma Electronics                    NEW
   Sadar Bazar · ₹12,450 due
   ```

   - Second line uses the existing `--color-locked` @ 12px (today's `.retailerMeta` token) — thin and grey, **red only when over the credit limit**; nothing else is colourised.
   - `₹0` renders **"Clear"**; a retailer with **no credit data at all renders nothing** — *the two states must not look identical: "we know they're clear" and "we know nothing" are different facts.*
   - Negative balance renders **"₹5,000 advance"**.
   - No per-row timestamp (noise ×622); one **"Balances as of …"** line sits above the list, and the chosen retailer's confirmation card still carries the full D4 arithmetic + the over-limit banner.
   - Same treatment in the **deposit flow's** picker — arguably the highest-value placement, since that screen exists to collect the money.
   - Plumbing: a separate `["retailer-credit"]` query merged client-side by `retailer_id`, **not** folded into the shared `["retailers"]` superset — keeps money on its own cache key (D1's reasoning) while still being one bounded fetch of ~622 rows.
2. **Order detail** — a "Retailer" band under the header: outstanding · limit · headroom, **live (not snapshotted)** with its as-of, so the admin sees it immediately before Approve. *Live beats a snapshot here because the number informs a decision being made now; it is reference, not part of the order's money math, so the immutable-snapshot law doesn't apply. (Snapshotting `retailer_outstanding_at_order` for audit is a v2 option, not v1.)*
3. **Orders list** — nothing per row (noise + a join per row). An "over limit" filter chip is a v2 candidate.
4. **Retailers list** — Outstanding as a sortable desktop column / second line on phone rows, plus a new **"Over limit"** filter tab beside all/pending/verified/deactivated, and a "Last sync … · N matched · N unmatched" line (D8).
5. **Retailer detail page** — the full ledger (D6).
6. **Analytics** — receivables total, top debtors, over-limit count. *This is what unlocks the "outstanding receivables" item I previously listed as impossible in the analytics plan.*
7. **Notifications** — v2 hook: an over-limit order could add a line to the admin's 🛒 card. Out of v1 scope.

## D6 — The retailer detail page

**Routes:** `/dashboard/retailers/[id]` (staff) and `/retailers/[id]` (salesman lens) — one component, a `role` prop, mirroring the twin-lens `OrderDetailView` pattern.

**Reachability** (the owner's "how to route the display" question): the retailer name becomes a **link wherever it already appears** — order detail header, deposits rows, orders list retailer cell — plus row-click on the Retailers list. **No new salesman nav tab in v1** *(the phone tab bar is owner-final; the name link reaches the page from every screen a salesman already uses).*

Row-click on the Retailers list should open the **page**, with **Edit** in the page header opening the existing `RetailerModal`. *This diverges from the Products page's row-click-opens-modal grammar on purpose: a product's whole story is its modal, a retailer's is not.*

**Anatomy (top to bottom):**
- **Header** — name, area, phone (tap-to-call), verified / inactive badges, Edit (staff), "added by X on date".
- **Money band** — the D4 arithmetic, credit limit, headroom with a traffic light (green / amber near limit / red over), staleness chip.
- **Stat strip** — lifetime billed, order count, average order, last order (+ days ago), last deposit, total collected.
- **Orders** — that retailer's orders with status chips, tap → order detail. Bounded query by `retailer_id`.
- **Deposits** — date, amount, method, collected by, note, voided badge.
- **Actions** — "New order for this retailer" and "Record deposit" (both prefilled deep links).
- **Empty states** — the common case: 542 retailers have never ordered.

## D7 — Visibility: **DECIDED — every salesman sees every retailer's outstanding** (owner, 2026-07-30)

`retailer_credit` gets a SELECT policy for all active profiles, mirroring `retailers_select_salesman` (which already exposes every active retailer to every salesman). *Collection is the salesman's job; the number changes what he does in the shop.*

Unchanged by this: the ledger page's **orders and deposits sections stay RLS-scoped** to the viewer — a salesman sees his own orders and his own collections, so those sections must be **labelled** ("your orders" / "your collections") or a partial history reads as the whole one. Balance = shared truth; history = your slice.

## D8 — Sync audit

`credit_sync_runs`: `id, ran_at, source, actor, matched, unmatched_count, ambiguous_count, unmatched jsonb, ambiguous jsonb`.

Surfaced on the Retailers page as **"Last sync 6:05 am · 618 matched · 3 unmatched · 1 ambiguous"**, with the unmatched list downloadable. *That list is the cleanup worklist that gradually reconciles 622 app names against Tally's ledger names — the same job the ~94 missing Tally products taught us to make visible instead of silent.*

Per-retailer history (for an outstanding trend line) is **v2** — cheap to add later, pointless before the first sync exists.

## D9 — Deliberately out of scope for v1

Named so they're decisions, not oversights: **aging buckets** (0–30/31–60/61–90/90+ — needs Tally's bills-outstanding report; the single biggest v2 upgrade) · **hard-blocking over-limit orders** (v1 warns; a block needs an owner policy and an override path) · **editing credit limits in-app** (Tally owns them) · interest/overdue penalties · statement PDFs · WhatsApp reminders.

## Acceptance (build-time, by execution)

1. Real Tally file imports; matched/unmatched/**ambiguous** counts are truthful, and the duplicate name updates **neither** row.
2. Same file twice → byte-identical state (idempotent).
3. `"1,24,500.50"` → `12450050` paise exactly; a junk cell is rejected and reported, never zeroed.
4. A negative balance renders as "₹X advance", not "−₹X owed".
5. Agent path succeeds with the secret; a wrong secret returns unauthorized and leaks nothing.
6. Two-account check: a salesman session shows exactly what D7 allows — no more.
7. A deposit recorded after `as_of` moves the effective line by exactly that amount; voiding it moves it back.
8. Stale chip appears at 36 h; the effective line disappears at 7 days.
9. All 622 rows import well inside the statement timeout.
10. The retailer page renders correctly for a zero-order retailer and for the heaviest one.

## Build order

0. **DB gate** — owner approves `retailer_credit` + `credit_sync_runs` + 2 RPCs + index; applied as one migration.
1. **Ingestion first, display second** — the admin wizard, so matching is proven against the real file before any UI depends on it.
2. Agent path + secret (owner sets it on the VPS beside `stock_push`).
3. Display: retailers list column + order detail band + picker warning.
4. Retailer detail page (staff lens, then salesman lens).
5. v2 hooks: analytics receivables, notification line, aging.

## Open questions for the owner

1. Does Tally give a per-ledger **credit limit**, or only the balance? (Limit-dependent UI degrades gracefully to headroom-unknown. **This now also decides whether the picker's red-when-over-limit state can exist at all.**)
2. Over-limit at approval: warn only, or require an explicit "approve anyway"?
3. Retailers list row-click → the new page (recommended) or keep today's edit modal?
4. Same VPS agent/cron as stock (one run, two reports) or a separate job?
5. **What does the Tally export actually look like** — columns, headers, Dr/Cr, one file or a report? The parser gets shaped to the real file, not a guess.
