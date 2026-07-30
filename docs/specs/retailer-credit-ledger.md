# Retailer credit & ledger — spec v2 (2026-07-31)

Mirror each retailer's **Tally account** into the app: the outstanding balance, and the statement behind it. Show the balance where credit decisions happen, and give every retailer a **ledger page** — the retailer-side twin of the order detail page.

**Status: DESIGN — owner-directed rewrite of v1 (2026-07-31). Nothing built. Contains DB changes (3 tables + RPCs) needing explicit owner approval at build time (prod-caution rule).**

## Doctrine (owner, 2026-07-31) — this is what v2 changes

**Tally is the only source of the retailer ledger. The app never contributes to it.**

An app order is a capture, not a sale; an app deposit is a field record, not a receipt. Neither is true until the office punches it into Tally. So the ledger displays **only** what Tally returns, and the app's own orders and deposits are never added to, subtracted from, or reconciled against it.

*This deletes v1's D4 entirely* — the "outstanding − collected-in-app = effective estimate" arithmetic, its `estimate` label and its staleness-hiding rules are gone. One source, one number, no asterisk.

## The data reality (verified live, 2026-07-30)

| Fact | Consequence |
|---|---|
| 622 retailers (599 active) | Bounded; fetch-all + client filtering stays viable |
| **`tally_ledger_name` empty on all 622** | Match on `name`, with `tally_ledger_name` as an override (D2) |
| **1 duplicate name** (`[shop redacted]` ×2) | Ambiguous keys must update nothing — money would double-post (D2) |
| 80 retailers have app orders; 8 app deposits exist | Irrelevant to the ledger now, by doctrine — but it means ledger pages are mostly sparse |
| Money is integer paise everywhere | Tally's rupee decimals convert on the way in (D3) |

## D1 — Three tables

**Why the balance is stored, not computed.** Tally's closing balance covers the account's entire history. Our statement window (2 months) does not. A shop whose oldest unpaid bill predates the window would have `sum(entries) ≠ balance` — so **deriving the balance from the entries is structurally wrong**, and would be wrong *silently*. We store what Tally computes and use the entries for display only.

```
retailer_credit                        -- one row per matched retailer
  retailer_id        uuid PK → retailers(id) on delete cascade
  outstanding_paise  bigint  not null  -- Tally closing balance; + = owes us, − = advance
  opening_paise      bigint            -- balance at window start (feeds the D4 check)
  credit_limit_paise bigint            -- null when Tally doesn't maintain one
  window_from        date              -- statement window covered by the entries
  window_to          date
  reconciled         boolean           -- opening + entries == outstanding (D4)
  as_of              timestamptz not null
  source             text not null     -- 'agent' | 'import'

retailer_ledger_entries                -- the statement lines, display only
  id             bigserial PK
  retailer_id    uuid not null → retailers(id) on delete cascade
  entry_date     date   not null
  voucher_type   text   not null       -- Sales / Receipt / Credit Note / Journal …
  voucher_no     text                  -- bill / receipt number as Tally shows it
  narration      text
  debit_paise    bigint not null default 0
  credit_paise   bigint not null default 0
  index (retailer_id, entry_date desc)

credit_sync_runs                       -- the match report / cleanup worklist
  id, ran_at, source, actor,
  matched int, unmatched_count int, ambiguous_count int, unreconciled_count int,
  unmatched jsonb, ambiguous jsonb
```

*No `updated_at` churn on entries: they are replaced wholesale, never edited (D3).*

## D2 — Match key + the ambiguity rule *(unchanged from v1)*

Key = `lower(regexp_replace(btrim(coalesce(nullif(btrim(tally_ledger_name),''), name)), '\s+', ' ', 'g'))`, with a functional index mirroring `products_tally_lower_idx`.

*Whitespace is collapsed, not just trimmed — measured: 6 retailer names carry internal double spaces, which would silently miss a Tally name spelled with single spaces. Collapsing fixes all six and adds zero collisions. Punctuation is deliberately not stripped.*

**Ambiguity rule:** a key matching more than one retailer updates **nothing** and is reported in an `ambiguous` bucket. *Verified 2026-07-30: `import_stock`'s `UPDATE … FROM` writes to every row sharing a key — for a quantity that's wrong, for money it double-posts. `UNIQUE (brand_id, tally_name)` is case-sensitive and cross-brand-blind; retailers have no name constraint at all and one live duplicate.*

**Pre-sync cleanup (awaiting owner go):** Tally enforces unique ledger names, so all collisions are app-side. The one live collision is a ghost+real pair of the same shop — `[shop redacted]` from the 2026-07-07 bulk import (no area/phone, **0 orders**) and the 2026-07-23 field entry (area Dipka, phone [phone redacted], **1 order**). Deactivating the ghost orphans nothing.

## D3 — Ingestion: one run, two pulls, wholesale replace

Each sync pulls **both** and applies them in one transaction per retailer:

1. **Balances** — `Ledger` collection filtered to Sundry Debtors: name, closing balance, opening balance at `window_from`, credit limit if maintained.
2. **Statement lines** — the vouchers for `window_from … window_to` per ledger.

**Wholesale replace, never incremental:** every run deletes and rewrites the window's entries for each matched retailer. *This is what makes back-dated entries, edited vouchers and deleted vouchers self-heal. An incremental feed cannot see a deletion, and its error persists forever.*

| Path | Function | Gate | Trigger |
|---|---|---|---|
| Manual | `import_credit(p_rows jsonb)` | `auth_profile_role() = 'admin'` | Import wizard on the Retailers page (reuse the `StockImportWizard` shell) |
| Automated | `import_credit_agent(p_secret, p_rows)` | sha256 vs `agent_config` row `name='credit_push'` — **its own secret** | The VPS Tally agent, alongside stock |

Both return `{matched, unmatched[], ambiguous[], unreconciled[]}`, and both write one `credit_sync_runs` row.

**Payload:** one object per ledger — `{ ledger_name, closing, opening, credit_limit?, window_from, window_to, entries: [{date, voucher_type, voucher_no, narration, debit, credit}] }`. Amounts arrive as **rupees**, converted to paise server-side: accept `^-?[0-9]{1,12}(\.[0-9]{1,2})?$` after stripping commas; **a bad amount rejects its row and is reported — never coerced to 0** *(a silently-zeroed balance reads as "this shop is clear", the most dangerous wrong answer available)*. Sign convention: **positive = the retailer owes us**; the agent normalizes Tally's Dr/Cr (see D3b trap 1).

Set-based, single pass, same CTE shape as `import_stock` — *the 20260719194611 lesson: a per-row loop timed out at 2000 rows; set-based ran 18ms.*

### D3b — Getting the data out of Tally (researched 2026-07-31)

**A near-copy of the shipped stock extractor**, not new ground: `tally-agent/stock_export.py` already POSTs an `<TALLYREQUEST>Export</TALLYREQUEST>` Collection envelope to `http://localhost:9000`, parses with stdlib, writes a timestamped file. Credit swaps `StockItem` for **`Ledger`** plus a voucher pull over `SVFROMDATE`/`SVTODATE`. The **read-only guarantee is inherited verbatim** — Export only; never `Import`/`Alter`/`Create`, not even commented out. One run emits both stock and credit files: **one script, one double-click.**

Three calibration items documentation cannot settle — they need one run against the real company file, **before** any app work is built:

1. **⚠️ Sign convention — the money trap.** A receivable is a debit and Tally's XML commonly returns it **negative**; integration write-ups state "amount owed is the negation". Guess wrong and every debtor renders as holding an advance. **Verify three shops against Tally's own screen**, then normalize in the agent.
2. **Filter to Sundry Debtors.** An unfiltered Ledger collection returns banks, GST, expenses, capital — hundreds of rows that would drown the unmatched worklist.
3. **Credit limit is conditional.** Only present if the office maintains it. Absent → the whole over-limit tier (red rows, Over-limit tab, approval banner) **degrades to balances-only**. That is the designed fallback, not a bug.

**Aging stays v2+:** it needs the `Bills` collection (bill-wise details + due dates) and bill-wise accounting enabled per party — a different query with a different prerequisite.

## D4 — Reconciliation as a check, not a calculation *(replaces v1's D4 entirely)*

`opening_paise + Σ(debits − credits) == outstanding_paise` is verified per retailer at import and stored as `reconciled`.

*The owner's baseline-plus-replay idea is right as a **validator** and dangerous as a **source**: as a source it silently reimplements an accounting engine (credit notes, journals, discounts, back-dated entries, deleted vouchers) and any miss corrupts the number permanently. As a check it costs nothing and catches an incomplete extract.*

- **Reconciles** → the statement provably explains the balance. Nothing shown.
- **Doesn't reconcile** → the balance still displays (Tally computed it, it is right); the *statement* carries a quiet note: **"Some entries are older than this statement"** — which is the ordinary, expected case for a shop with a bill predating the window. `unreconciled_count` is reported in the sync run so a systemic extract failure is visible rather than mistaken for old bills.

## D5 — Where the balance appears

1. **Retailer picker** (Quick Order + deposit flow) — the balance rides **every row**, as a muted second line under the shop name (owner call): `Sadar Bazar · ₹12,450 due`. Grey by default, **red only when over limit**. `₹0` → **"Clear"**; no credit data → **nothing at all** *(the two must not look identical — "known clear" and "unknown" are different facts)*; negative → **"₹5,000 advance"**. One **"Balances as of …"** line above the list, never per row.
2. **Order detail** (both lenses) — a retailer band under the header: outstanding · limit · headroom, live, with its as-of, so the admin sees the shop's position on the way to Approve. Over-limit adds a banner naming the gap and what this order adds.
3. **Orders list** — nothing per row (noise + a join per row). An "over limit" filter chip is a later candidate.
4. **Retailers list** — Outstanding / Limit / Headroom columns (desktop), second line (phone), an **Over limit** tab, the book total in the header, and the **sync line** (`618 matched · 3 unmatched · 1 ambiguous`).
5. **Retailer ledger page** — D6.
6. **Analytics** — receivables total, top debtors, over-limit count. *Unlocks the "outstanding receivables" metric previously listed as impossible.*

## D6 — The retailer ledger page

**Routes:** `/dashboard/retailers/[id]` (staff) and `/retailers/[id]` (salesman) — one component, a `role` prop, mirroring `OrderDetailView`'s twin-lens pattern.

**Reachability:** the retailer name becomes a link wherever it already appears — order detail header, deposits rows, orders list retailer cell — plus row-click on the Retailers list (Edit moves into the page header). **No new salesman nav tab.**

**Anatomy:**
- **Header** — name, area, phone (tap-to-call), verified/inactive badges, Edit (staff).
- **Balance** — outstanding, credit limit, headroom with a traffic light, `as of <time>`. One number, no arithmetic stack (D4 is gone).
- **Statement** — the Tally lines: date · voucher type · number · debit · credit · **running balance**, newest first, over the synced window. This *is* the page's centre of gravity.
- **Stat strip** — from the statement: billed in window, received in window, last invoice, last receipt.
- **Open in the app** *(reviewer's call, easily cut)* — app orders **not yet billed**, and nothing else. *Rationale: a billed order already appears in the statement as an invoice, so repeating it would double-show the same sale; an unbilled one is the single thing Tally cannot know yet, which makes it additive rather than a competing version of the truth. Everything else app-side stays off this page per the doctrine.*
- **Actions** — "New order" and "Record deposit", both prefilled.
- **Empty states** — a shop with no Tally data reads **"not in the last sync"**, never ₹0.

## D7 — Visibility: every salesman sees the balance *(owner, 2026-07-30)*

`retailer_credit` gets a SELECT policy for all active profiles, mirroring `retailers_select_salesman`. *Collection is the salesman's job; the number changes what he does in the shop.*

**Open:** the same question for `retailer_ledger_entries` — the statement exposes the shop's whole account, including business a given salesman had no part in. Default assumed: **same visibility as the balance** (if you can see what they owe, seeing why is not a further leak). Flagged for confirmation.

*Note: the RLS-partial-history problem from v1 dissolves here — a Tally statement is the shop's real account, not one salesman's slice, so no "your orders / your collections" labelling is needed.*

## D8 — Sync audit

`credit_sync_runs` surfaces on the Retailers page as **"Last sync 6:05 am · 618 matched · 3 unmatched · 1 ambiguous"**, unmatched downloadable. *That list is the worklist that reconciles 622 app names against Tally's ledger names — the same job the ~94 missing Tally products taught us to make visible instead of silent.*

## D9 — Deliberately out of scope

Aging buckets (needs the Bills collection + bill-wise accounting) · hard-blocking over-limit orders (v1 warns; a block needs a policy and an override path) · editing credit limits in-app (Tally owns them) · auto-matching app deposits to Tally receipts *(amount+date matching is exactly the guessing that produces confident wrong answers)* · interest/penalties · statement PDFs · payment reminders.

## Acceptance (by execution)

1. Real Tally export imports; matched / unmatched / **ambiguous** / **unreconciled** counts are truthful; the duplicate name updates **neither** row.
2. Same file twice → byte-identical state (idempotent), including entries (wholesale replace).
3. A voucher **deleted** in Tally disappears from the app after the next sync; an **edited** one updates; a **back-dated** one lands in date order.
4. `"1,24,500.50"` → `12450050` paise exactly; a junk amount is rejected and reported, never zeroed.
5. Negative balance renders "₹X advance", not "−₹X owed"; sign verified against three shops on Tally's own screen.
6. Agent path succeeds with the secret; wrong secret returns unauthorized and leaks nothing.
7. A shop whose oldest bill predates the window shows the right balance and the "older entries" note — not a wrong total.
8. Statement running balance ends exactly at the outstanding figure when reconciled.
9. 622 retailers + ~2 months of vouchers import well inside the statement timeout.
10. Ledger page renders for: a shop with no Tally data, a clear shop, an over-limit shop, and the heaviest account.

## Build order

0. **DB gate** — owner approves the 3 tables + RPCs + index as one migration.
1. **Extractor first** — one real run against the real company file, settling sign, debtor filter, credit-limit availability and name hit-rate **before** any UI is built.
2. Ingestion: admin wizard, proving matching against that real file.
3. Agent path + secret (VPS, beside `stock_push`).
4. Display: retailers list columns + picker rows + order detail band.
5. Ledger page (staff lens, then salesman lens).
6. Later: analytics receivables, notification hook, aging.

## Open questions

1. **Statement window** — 2 months as stated? (Longer = more history and a higher reconcile rate; the balance is correct either way.)
2. Does Tally give a per-ledger **credit limit**? Decides whether the over-limit tier exists at all.
3. Salesmen see the **full statement**, or balance-only? (D7)
4. Keep the "**Open in the app**" section (unbilled orders only), or strip the page to pure Tally?
5. Over-limit at approval: warn only, or require an explicit "approve anyway"?
6. Retailers list row-click → the new page (recommended) or keep today's edit modal?
