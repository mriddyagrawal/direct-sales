# Retailer credit & ledger — spec v2 (2026-07-31)

Mirror each retailer's **Tally account** into the app: the outstanding balance, and the statement behind it. Show the balance where credit decisions happen, and give every retailer a **ledger page** — the retailer-side twin of the order detail page.

**Status: DESIGN v2.2 — extraction PROVEN END TO END 2026-07-31 (`tally-agent/ledger_sync.py`); app-side build not started. No app/DB work started; contains DB changes (3 tables + RPCs) needing explicit owner approval at build time (prod-caution rule).**

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

**Calibration run completed 2026-07-31** — the extractor ran against the real company and settled every open assumption:

| Measured | Result |
|---|---|
| Tally ledgers / under the Sundry Debtors tree | 3,561 / **2,976** (shops sit in ~140 beat sub-groups, up to 4 levels deep) |
| App retailers matching a Tally ledger | **592 of 598 (99.0%)** on the normalised key — the match design holds |
| The 6 non-matches | 2 test fixtures + **4 spelling variants whose Tally counterpart was found** (`[shop redacted]`→`[shop redacted]`, `… (Rm)`→`… (Rm) NET`, `[SHOP REDACTED]`→`[SHOP REDACTED] LG`, `[shop redacted]`→`[shop redacted]`) — zero shops genuinely absent |
| **Sign convention** | **CONFIRMED: a receivable exports NEGATIVE.** Flip on the way in. Owner verified two ledgers against Tally's screen |
| Balances for 2,976 ledgers | **0.5 s** — the daily sync is effectively free |
| Coverage of the app's shops | 249 owe ₹[amount redacted] · 35 hold advances · 305 exactly zero · 2 no figure |
| Share of the whole debtors book | ~⅔ (₹1.17 cr of ₹1.77 cr); the rest is non-shop ledgers |

Full per-shop listing for the owner: [tally-retailer-balances-2026-07-31.md](../tally-retailer-balances-2026-07-31.md).

### Extraction proven end to end (2026-07-31 05:05, `ledger_sync.py`)

| Check | Result |
|---|---|
| **Reconciliation** — per shop, `sum(statement legs)` vs `closing − opening` | **2,976 of 2,976 (100%)** |
| Statement completeness — vouchers summing to zero | **4,848 of 4,848** |
| Independent cross-check vs the app's own billed orders | 18 of 20 matched on (shop, bill no) to the rupee; **all 18 debit the shop** |
| `[shop redacted]` vs Tally's own screen | ₹[amount redacted] owed — **exact**, via a different code path |
| Book total, two independent runs | ₹[amount redacted] across 323 shops — identical |
| Cost | balances 0.6 s · statement 12.9 s · whole run **under 20 s** |

**Sign convention, settled four ways:** receivables export negative · sales legs debit the shop on every matched invoice · the discount leg proves the sign outranks the `is_debit` label · and once both halves used one dialect, everything reconciled. *The pipeline's single rule: **negative = debit = owed to us**, flipped once at the CSV boundary so `outstanding` is positive when a shop owes.*

**Two traps worth carrying into the app build:** a Collection export's `ClosingBalance` **ignores `SVTODATE`** (byte-identical replies at two dates) — only the REPORT engine is period-aware; and `$$String:$$NumValue:…` silently evaluates to **nothing**, which reads as "every shop is square" rather than as an error.

## D1 — One new table, two new columns *(reduced 2026-07-31 after owner pushback)*

*v2 proposed three tables. The owner asked why, and most of it did not survive the question — it was structure collecting data nobody would read.*

```sql
alter table public.retailers
  add column outstanding_paise bigint,      -- POSITIVE = owes us; NULL = not in the last sync
  add column balance_as_of     timestamptz;

create table public.retailer_ledger_entries (
  id           bigserial primary key,
  retailer_id  uuid not null references public.retailers(id) on delete cascade,
  entry_date   date not null,
  voucher_type text not null,
  voucher_no   text,
  debit_paise  bigint not null default 0,
  credit_paise bigint not null default 0
);
create index on public.retailer_ledger_entries (retailer_id, entry_date desc);
```

**What was cut, and why** — each of these existed for a reason that turned out not to hold:

| Dropped | Why it isn't needed |
|---|---|
| `retailer_credit` as its own table | Its main justification was hiding money from salesmen. The owner decided salesmen *should* see it, which killed the argument — and the picker already fetches `retailers`, so the balance now arrives with no join |
| `credit_sync_runs` | Its job is the unmatched worklist, which you only act on **at import time** — the wizard's result screen shows it there, with a download. A wrong-company guard is stronger as a **confirmation step in the wizard** than as a log nobody reads |
| `opening_paise` | The statement's running balance walks **backwards** from closing; opening only ever fed the reconciliation, which now happens in `ledger_sync.py` before the file reaches the app |
| `reconciled` per shop | Enforced at the door instead: **the wizard refuses a payload that did not reconcile 100%**. Per-row flags are for when partial trust is acceptable; here it is not |
| `window_from` / `window_to` | `min/max(entry_date)` gives it for display; the replace range arrives in the payload at import time and nothing needs to remember it |
| `tally_group` (the beat) | Nothing in the app reads beats, and it arrives in every export anyway — storing it was collecting data because it was there |

**The one column worth defending:** `balance_as_of`. Without it a three-week-old balance is indistinguishable from a fresh one, and `NULL` stops meaning "never synced" as opposed to "synced and genuinely zero".

**Accepted cost of putting the balance on `retailers`:** godown sees balances too (their RLS grants active retailers), and the sync becomes an `UPDATE` on an identity table — so the RPC must set exactly those two columns and nothing else. That is code discipline where a side table gave a structural guarantee.

## D2 — Match key + the ambiguity rule *(unchanged from v1)*

Key = `lower(regexp_replace(btrim(coalesce(nullif(btrim(tally_ledger_name),''), name)), '\s+', ' ', 'g'))`, with a functional index mirroring `products_tally_lower_idx`.

*Whitespace is collapsed, not just trimmed — measured: 6 retailer names carry internal double spaces, which would silently miss a Tally name spelled with single spaces. Collapsing fixes all six and adds zero collisions. Punctuation is deliberately not stripped.*

**Ambiguity rule:** a key matching more than one retailer updates **nothing** and is reported in an `ambiguous` bucket. *Verified 2026-07-30: `import_stock`'s `UPDATE … FROM` writes to every row sharing a key — for a quantity that's wrong, for money it double-posts. `UNIQUE (brand_id, tally_name)` is case-sensitive and cross-brand-blind; retailers have no name constraint at all and one live duplicate.*

**⚠️ Correction (measured 2026-07-31): Tally's ledger-name uniqueness is CASE-SENSITIVE**, so collisions are *not* only app-side as v1 claimed. The real export contains `[shop redacted]` (RETAIL DEBTORS, owes ₹[amount redacted]) *and* `[SHOP REDACTED]` (Sundry Debtors, no balance) — one app shop, two ledgers. The ambiguity rule therefore protects against duplicates on **both** sides, and it earns its place from day one rather than hypothetically.

**Pre-sync cleanup (awaiting owner go):** The one live collision is a ghost+real pair of the same shop — `[shop redacted]` from the 2026-07-07 bulk import (no area/phone, **0 orders**) and the 2026-07-23 field entry (area Dipka, phone [phone redacted], **1 order**). Deactivating the ghost orphans nothing.

## D3 — Ingestion: one run, two pulls, wholesale replace

Each sync pulls **both** and applies them in one transaction per retailer:

1. **Balances** — `Ledger` collection filtered to Sundry Debtors: name, parent group, closing balance, opening balance at `window_from`.
2. **Statement lines** — the vouchers for `window_from … window_to` per ledger.

**Wholesale replace, never incremental:** every run deletes and rewrites the window's entries for each matched retailer. *This is what makes back-dated entries, edited vouchers and deleted vouchers self-heal. An incremental feed cannot see a deletion, and its error persists forever.*

| Path | Function | Gate | Trigger |
|---|---|---|---|
| Manual | `import_credit(p_rows jsonb)` | `auth_profile_role() = 'admin'` | Import wizard on the Retailers page (reuse the `StockImportWizard` shell) |
| Automated | `import_credit_agent(p_secret, p_rows)` | sha256 vs `agent_config` row `name='credit_push'` — **its own secret** | The VPS Tally agent, alongside stock |

Both return `{matched, unmatched[], ambiguous[], unreconciled[]}`, and both write one `credit_sync_runs` row.

**Payload:** one object per ledger — `{ ledger_name, closing, opening, window_from, window_to, entries: [{date, voucher_type, voucher_no, narration, debit, credit}] }`. Amounts arrive as **rupees**, converted to paise server-side: accept `^-?[0-9]{1,12}(\.[0-9]{1,2})?$` after stripping commas; **a bad amount rejects its row and is reported — never coerced to 0** *(a silently-zeroed balance reads as "this shop is clear", the most dangerous wrong answer available)*. Sign convention: **positive = the retailer owes us**; the agent normalizes Tally's Dr/Cr (see D3b trap 1).

Set-based, single pass, same CTE shape as `import_stock` — *the 20260719194611 lesson: a per-row loop timed out at 2000 rows; set-based ran 18ms.*

### D3b — Getting the data out of Tally (researched 2026-07-31)

**A near-copy of the shipped stock extractor**, not new ground: `tally-agent/stock_export.py` already POSTs an `<TALLYREQUEST>Export</TALLYREQUEST>` Collection envelope to `http://localhost:9000`, parses with stdlib, writes a timestamped file. Credit swaps `StockItem` for **`Ledger`** plus a voucher pull over `SVFROMDATE`/`SVTODATE`. The **read-only guarantee is inherited verbatim** — Export only; never `Import`/`Alter`/`Create`, not even commented out. One run emits both stock and credit files: **one script, one double-click.**

Three calibration items documentation cannot settle — they need one run against the real company file, **before** any app work is built:

1. **⚠️ Sign convention — the money trap.** A receivable is a debit and Tally's XML commonly returns it **negative**; integration write-ups state "amount owed is the negation". Guess wrong and every debtor renders as holding an advance. **Verify three shops against Tally's own screen**, then normalize in the agent.
2. **Filter to Sundry Debtors.** An unfiltered Ledger collection returns banks, GST, expenses, capital — hundreds of rows that would drown the unmatched worklist.
3. ~~Credit limit~~ — **dropped entirely (owner, 2026-07-31).** Not extracted, not stored, not displayed. *Consequence, accepted: there is no over-limit tier at all — no red rows, no "Over limit" filter tab, no headroom column, no approval banner. Credit is reported, never policed. The screens get quieter and the collections signal becomes **days since last receipt** rather than a limit breach.*

**Aging stays v2+:** it needs the `Bills` collection (bill-wise details + due dates) and bill-wise accounting enabled per party — a different query with a different prerequisite.

## D4 — Reconciliation as a check, not a calculation *(replaces v1's D4 entirely)*

`opening_paise + Σ(debits − credits) == outstanding_paise` is verified per retailer at import and stored as `reconciled`.

*The owner's baseline-plus-replay idea is right as a **validator** and dangerous as a **source**: as a source it silently reimplements an accounting engine (credit notes, journals, discounts, back-dated entries, deleted vouchers) and any miss corrupts the number permanently. As a check it costs nothing and catches an incomplete extract.*

- **Reconciles** → the statement provably explains the balance. Nothing shown.
- **Doesn't reconcile** → the balance still displays (Tally computed it, it is right); the *statement* carries a quiet note: **"Some entries are older than this statement"** — which is the ordinary, expected case for a shop with a bill predating the window. `unreconciled_count` is reported in the sync run so a systemic extract failure is visible rather than mistaken for old bills.

## D5 — Where the balance appears

1. **Retailer picker** (Quick Order + deposit flow) — the balance rides **every row**, as a muted second line under the shop name (owner call): `Sadar Bazar · ₹12,450 due`. Grey throughout — no red state (no limits, D3b). `₹0` → **"Clear"**; no credit data → **nothing at all** *(the two must not look identical — "known clear" and "unknown" are different facts)*; negative → **"₹5,000 advance"**. One **"Balances as of …"** line above the list, never per row.
2. **Order detail** (both lenses) — a retailer band under the header: outstanding, its as-of, and **days since the last receipt**, live, so the admin sees the shop's position on the way to Approve. *A big balance on a paying shop is business; the same balance on a silent shop is exposure — with limits gone, recency is the signal that carries that difference.*
3. **Orders list** — nothing per row (noise + a join per row).
4. **Retailers list** — Outstanding + **last bill / last receipt** columns (desktop), second line (phone), the book total in the header, and the **sync line** (`618 matched · 3 unmatched · 1 ambiguous`).
5. **Retailer ledger page** — D6.
6. **Analytics** — receivables total, top debtors, oldest-unpaid. *Unlocks the "outstanding receivables" metric previously listed as impossible.*

## D6 — The retailer ledger page

**Routes:** `/dashboard/retailers/[id]` (staff) and `/retailers/[id]` (salesman) — one component, a `role` prop, mirroring `OrderDetailView`'s twin-lens pattern.

**Reachability:** the retailer name becomes a link wherever it already appears — order detail header, deposits rows, orders list retailer cell — plus row-click on the Retailers list (Edit moves into the page header). **No new salesman nav tab.**

**Anatomy:**
- **Header** — name, area, phone (tap-to-call), verified/inactive badges, Edit (staff).
- **Balance** — outstanding and `as of <time>`. One number, no arithmetic stack (D4 is gone), no limit (D3b).
- **Statement** — the Tally lines: date · voucher type · number · debit · credit · **running balance**, newest first, over the synced window. This *is* the page's centre of gravity.
- **Stat strip** — from the statement: billed in window, received in window, last invoice, last receipt.
- **Open in the app** *(reviewer's call, easily cut)* — app orders **not yet billed**, and nothing else. *Rationale: a billed order already appears in the statement as an invoice, so repeating it would double-show the same sale; an unbilled one is the single thing Tally cannot know yet, which makes it additive rather than a competing version of the truth. Everything else app-side stays off this page per the doctrine.*
- **Actions** — "New order" and "Record deposit", both prefilled.
- **Empty states** — a shop with no Tally data reads **"not in the last sync"**, never ₹0.

## D7 — Visibility: every salesman sees the balance *(owner, 2026-07-30)*

`retailer_credit` gets a SELECT policy for all active profiles, mirroring `retailers_select_salesman`. *Collection is the salesman's job; the number changes what he does in the shop.*

**DECIDED 2026-07-31: salesmen see the statement too**, exactly as admin and accountant do. So `retailer_ledger_entries` gets a SELECT policy for every active profile, matching the balance. *One rule for the whole feature: if you can see what a shop owes, you can see why.*

*Note: the RLS-partial-history problem from v1 dissolves here — a Tally statement is the shop's real account, not one salesman's slice, so no "your orders / your collections" labelling is needed.*

## D8 — Sync audit

`credit_sync_runs` surfaces on the Retailers page as **"Last sync 6:05 am · 618 matched · 3 unmatched · 1 ambiguous"**, unmatched downloadable. *That list is the worklist that reconciles 622 app names against Tally's ledger names — the same job the ~94 missing Tally products taught us to make visible instead of silent.*

## D9 — Deliberately out of scope

Aging buckets (needs the Bills collection + bill-wise accounting) · **anything limit-based** (dropped, D3b) · auto-matching app deposits to Tally receipts *(amount+date matching is exactly the guessing that produces confident wrong answers)* · interest/penalties · statement PDFs · payment reminders.

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
2. Salesmen see the **full statement**, or balance-only? (D7)
3. Keep the "**Open in the app**" section (unbilled orders only), or strip the page to pure Tally?
4. Retailers list row-click → the new page (recommended) or keep today's edit modal?
