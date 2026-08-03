# The retailer detail page becomes the Tally ledger

Owner-approved 2026-08-03. Design: https://claude.ai/code/artifact/fad886d7-e3f3-4b52-9034-53d5def52b1a

**No DB work.** The table, the data and the policy all exist. If you think you
need a migration, stop and ask.

---

## What the page becomes

One job: **what this shop owes, and how it got there.** Name · one line of
contact · the balance · the statement. Nothing else.

**Removed:** the `<dl className={styles.facts}>` fact table (Area / Phone /
Tally ledger name). **Not added:** the app's own orders and deposits — the owner
considered and rejected them (2026-08-03). This page mirrors Tally only.

## The idea it is built on — do not lose this in the details

**The balance is stated at the top and proved at the bottom.** The same figure
appears twice with the entries between it as the working. That repetition is the
page's argument, not redundancy, and it is why the closing total carries a **2px
ink rule** (the app's existing "authoritative" device) rather than being one more
row.

Everything below follows from it. Where a decision looks arbitrary, this is why.

---

## What is already true — verified 2026-08-03, do not re-derive

| | |
|---|---|
| `retailer_ledger_entries` | `retailer_id · entry_date · voucher_type · voucher_no · debit_paise · credit_paise` |
| Rows today | **3,252** across **395 of 600** active shops · avg 8 per shop, max 50 |
| Its RLS | `ledger_entries_select_all` — **`auth_profile_role() IS NOT NULL`**. Any signed-in role reads every row |
| Shops needing an opening balance | **283 of 395** — avg ₹31,442, max ₹17.4 lakh |
| Shops with nothing at all | **202** (33 of them still owe money) |
| Voucher types | **11**, and they are Tally's own names |
| `RETAILER_SELECT` | has `outstanding_paise` but **NOT `balance_as_of`** — the page needs it |
| Existing ledger query builder | **none** — `src/lib/queries/` has no ledger file yet |
| The sync window | `WINDOW_MONTHS = 2`, but `_apply_ledger` deletes **only the span each payload declares**, so history **accumulates** — 1,287 rows already sit outside the current window and survive every run |

---

## Decisions (settled — build to these)

**1. Voucher types render VERBATIM.** `Rcpt G Type`, `SALES C TYPE`,
`Bajaj Sales`, `CREDIT NOTE RM` — Tally's exact strings, exact casing. **Do not
translate them** into Bill / Receipt / Credit note, and do not normalise the
casing.

This was tried in an earlier draft and was **wrong, not merely opaque**:
`Ganpati Payment` is 30 entries and **every one is a debit**, so mapping it to
"Receipt" would show money the shop owes *more* of as money coming in.
`Purchase Ganpati` had no mapping at all. `Rcpt G Type` has one debit among 1,627
credits, which any label would contradict.

The deeper reason: this page's value is that it can be held beside Tally and
agree. A name you cannot match, search or quote back defeats the point. Same
principle as `Dr`/`Cr` — match the system of record, not a textbook.

**Consequence to respect:** with the type no longer saying "Receipt" or "Bill",
**sign and colour are the only direction signal on the phone.** On desktop the
Debit/Credit columns carry it structurally, which is why desktop gets columns.

**2. The filter is SINCE — a start date only, never a from/to range.** Presets
`3M · 6M · This FY · All`, **default 6M**.

Forced by the design: the proof only lands if the window **ends today**. Filter
to June-only and the closing figure is not the current outstanding, so the page
would make a claim it cannot support. A start-only filter keeps it exact.

"This FY" is the Indian April–March year. `_fy_start()` in
`tally-agent/ledger_sync.py` already computes it — mirror that rule, do not
invent one. Default is 6M rather than This FY because in April a FY filter shows
almost nothing.

**3. The opening balance is the FIRST ROW, in date order — not a footer.**
Labelled `Balance before <the filter's start date>`, and derived:

```
opening = outstanding_paise − Σ(debit_paise − credit_paise) over the shown entries
```

Client-side, over data the page already holds. **No query, no DB work.**

It **recomputes as the filter changes**, which is correct — it answers "what did
they owe before this window". Be deliberate that the number moves on a chip tap;
that is the design, not a bug.

**Render it only when it is non-zero.** 112 of 395 shops reconcile on their own;
their statements genuinely add up and the row would say nothing. Its absence is
the signal.

**4. Identity is a name and one line — no table.** `Area · Phone`, present only
when they exist, absent (not blank) when they do not. **582 of 600 shops have no
area.** The phone is a `tel:` link — the one action on a read-only page.

**5. The Tally ledger name shows ONLY on an unsynced shop.** It is identical to
the shop name on **596 of 599**, so everywhere else it is noise; on a shop that
matched nothing it is the diagnosis. Amber, beside the "Not synced" chip.
Everywhere else it lives in the Edit modal, which is the only thing you would do
with it. This replaces the old "staff-only" rule.

**6. Desktop drops the two-column layout and takes the full width.** That layout
existed to hold the fact table beside the statement; with the table gone a left
column holding one number is furniture.

Desktop uses **Debit and Credit columns**, not signed amounts — how Tally writes
a ledger and how the sync stores it (`debit_paise`, `credit_paise`). It lets the
eye scan money-out against money-in as two stacks instead of parsing a sign on
every row. The **totals row foots both columns** and restates the difference as
the same figure that opens the page.

The phone cannot afford two money columns, so it signs and colours instead. That
divergence is deliberate and is why the two are drawn separately.

**7. Salesman sees the full statement.** Owner 2026-08-01. Only **Edit** and the
Tally ledger name are staff-only.

---

## Steps

**1 — `src/lib/queries/ledger.ts`.** A shared builder in the D12 shape, beside
`retailers.ts` / `orders.ts`. Fetch a shop's entries newest-first, filtered on
`entry_date >= <since>`. Add `balance_as_of` to `RETAILER_SELECT` — the page
needs it for the "as of" line, `authenticated` already holds column SELECT on it,
and the other three consumers are unaffected by one extra column.

**2 — The page, phone-first.** Rip out the fact table, add the claim, the
statement and the proof. Both lenses; the two staff-only bits per decision 5 and 7.

**3 — The since-filter**, wired to the query and to the opening-balance
derivation.

**4 — Desktop.** Full width, Debit/Credit columns, footed totals.

---

## Traps

**RLS on the ledger is wide open, and the retailer row is what actually scopes
this page.** `ledger_entries_select_all` grants every signed-in role every row,
so **do not** rely on it to hide anything. The 404 for a shop a salesman may not
see must keep coming from the **retailer** query (`retailers_select_salesman` is
active-only → `maybeSingle()` → `notFound()`), exactly as it does today. Fetch
the retailer first; if it 404s, never fetch the ledger.

**Money is paise.** `formatRupees` (en-IN). `outstanding_paise === null` reads
"not in the last sync", **never ₹0**. Reuse `readBalance` and `ledgerText` from
`src/lib/balance.ts` — four surfaces already share them; do not write a fifth
reading of a balance.

**The colour rule is the leak test, not this page's habit.** Owed is **red**
here — see the comment on `.balanceOwed` in `OrderDetailView.module.css`, which
states the rule and why the blue lists differ.

**CSS-module class names are not typed.** `styles.whatever` on a class that does
not exist compiles clean and renders unstyled. Grep the stylesheet for every
class you reference.

**A media query adds no specificity** — media overrides go **below** the rule
they override.

**A scripted find-and-replace that no-ops looks exactly like one that worked.**
Twice in the last branch. After a scripted edit, read the target back.

`tsc --noEmit` and `eslint src` clean before every commit.
