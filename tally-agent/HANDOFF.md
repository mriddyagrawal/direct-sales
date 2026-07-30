# Tally extraction — handoff after the 2026-07-31 night session

Written by the REVIEWER session for whoever picks this up next. Your work on
`ledger_statement_export.py` is the backbone of what now runs; this records what
changed on top of it, what got proven, and what is still yours.

## Outcome

**The extraction is proven end to end.** Final run, 05:05:

```
Step 3/5  balances    2,976 shops priced via the report engine; 370 moved
Step 4/5  statement   15,545 legs · 4,848 vouchers, 0 of which fail to balance
Step 5/5  reconciled  2,976 of 2,976  (100.0%)
            323 shops owe Rs [amount redacted] in total
```

Independent confirmations, none of which the script can fake:

| Check | Result |
|---|---|
| `[shop redacted]` vs Tally's own screen | ₹[amount redacted] owed — exact, via a different code path |
| App's own billed orders vs the statement | 18 of 20 matched on (shop, bill no) to the rupee; **all 18 debit the shop** |
| Book total across two runs on different engines | ₹[amount redacted] / 323 shops — identical |
| Whole run | under 20 seconds |

## What changed

**New: `ledger_sync.py`** — one file replacing the two-script flow, because the
reconciliation only means anything when both halves come from the *same* run.
Five steps: company → groups → shop list → balances at two dates → statement →
**reconcile**. It ends with one of three verdicts and refuses to bless data it
cannot check:

- `All N testable shops reconcile`
- `NOT SAFE TO LOAD YET — N shops do not reconcile`
- `USABLE, BUT UNVERIFIED` (opening had to be derived; the cross-check is then
  circular, so it is skipped rather than reported as a pass)

**Superseded, not deleted:** `credit_export.py` (its balances use the date-blind
collection engine), `ledger_statement_export.py` (its request shape lives on
inside `ledger_sync.py`), and `reconcile.py` (the comparison is now inline).

## Bugs found tonight, in order

1. **`&#4;` killed a 1.1 MB parse.** Tally emits *escaped* control characters
   (`<PARENT>&#4; Primary</PARENT>`), which XML forbids even escaped. Stripping
   raw control bytes is not enough. The sanitizer now handles bare `&`, raw
   control bytes and illegal numeric refs together.

2. **The group filter found the wrong 602 ledgers.** Matching on a ledger's
   *immediate parent name* found ledgers directly under "Sundry Debtors" that
   overlap the app's retailers by exactly **one**. The shops actually sit in ~140
   beat groups (`Appl Pali FRIDAY`, `SARGAM WHOLESALE WEDNUSDAY`) up to four
   levels beneath it. Fixed by fetching the group tree and filtering by
   **ancestry**. Ledger count went 602 → 2,976, and app match went 0.2% → 99%.

3. **`$OpeningBalance` is not period-aware.** It is the *book's* opening (start of
   the financial year) and does not move with `SVFROMDATE`; opening equalled
   closing on 393 of 393 non-zero ledgers, so `closing − opening` was
   structurally zero and the reconciliation had a degenerate right-hand side.
   Fixed by asking for `ClosingBalance` **as at two different dates**.

4. **A Collection export ignores `SVTODATE` entirely.** Same request at 30 Apr
   and 31 Jul returned **byte-identical** 1,171,087-byte replies. Only the
   **REPORT** engine is period-aware. Balances now go through the report engine,
   with the collection engine as fallback.

5. **`$$String:$$NumValue:…` evaluates to nothing** — the same trap you hit on
   the amount field, which I then reintroduced on the balance field. 244 KB of
   rows, every balance empty, reported as "0 shops owe Rs 0". The parser now
   **raises** when every balance is unreadable, because a page of zeros is
   indistinguishable from "all shops are square".

6. **The two halves spoke opposite dialects.** 88.3% reconciled, and every large
   failure was an *exact sign mirror*: the statement negates debits, the balance
   expression did not. Both expressions now share one rule — **negative = debit =
   owed to us** — flipped once at the CSV boundary so `outstanding` reads positive
   when a shop owes. The reconciliation also now *detects* this class and reports
   it as one diagnosis instead of hundreds of unrelated-looking failures.

## Your four questions

1. **Company** — still `unknown [whatever is open]`. `COMPANY` is pinnable and the
   served name is printed every run, but it is not set yet. **This is the last
   silent failure mode in the pipeline**: a wrong RDP session exports last year's
   book with no error anywhere.
2. **Opening balances** — no third query needed, and no reuse of `credit_export.py`
   either: `ledger_sync.py` gets a real opening from the report engine at the
   window's start date.
3. **Real run cost** — balances 0.6 s, statement 12.9 s over three monthly chunks,
   whole run under 20 s. Your ~3 MB estimate was close: 3.4 MB.
4. **Deleted vouchers** — confirmed, full-window re-export every time, and the app
   must replace the window rather than merge.

## Still open

- **Pin `COMPANY`.** One line. Highest value remaining.
- **Year-end**: if the office opens a new company each April, a window spanning
  1 April sees only one of the two books. Balances survive (carried forward);
  the statement has a boundary gap for ~2 months. The app must replace **exactly
  the date range the export declares it covered**, never a hard-coded two months.
- **The other session's dedupe** is moot now — `AllLedgerEntries` alone is used.
- **App side is untouched**: 3 tables, 2 RPCs, the import wizard and the ledger
  page all still to build. Spec: `docs/specs/retailer-credit-ledger.md` (v2.2).
- **`narration` dropped** per the owner — do not re-add it.

## Two traps to carry into the app build

- A Collection export's `ClosingBalance` **ignores the as-at date**. If anything
  later needs a historical balance, it must go through the report engine.
- Silent-empty is Tally's universal failure mode: unknown field, wrong export
  format, missing `FETCH`, bad expression — all return well-formed XML with
  nothing in it. Anything that reads a Tally value must be able to tell
  "genuinely zero" from "I could not read this", and say so.
