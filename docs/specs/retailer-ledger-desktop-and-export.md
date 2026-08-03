# The ledger page: desktop columns, filter placement, and the statement export

Owner-approved 2026-08-04. Continues `docs/specs/retailer-ledger-page.md`, whose
**step 4 was never built** — the branch merged after step 3 and is live.
Design: https://claude.ai/code/artifact/fad886d7-e3f3-4b52-9034-53d5def52b1a

**No DB work.**

---

## Four things

**1. The statement flips to OLDEST-FIRST, opening balance at the top** — every surface.
**2. Desktop gets the Dr/Cr table** (the unbuilt step 4).
**3. The filter chips move ABOVE the STATEMENT heading.**
**4. An Export button producing a statement-of-account PDF.**

---

## 1. Oldest-first, opening at the top

Owner 2026-08-04. Today `fetchRetailerLedger` orders `ascending: false` and
`RetailerDetail` renders the opening balance **last** — with a correct reason:
it is the oldest thing on the list, so under newest-first entries it belongs at
the bottom. **That build is internally coherent and is not a bug.** This is a
deliberate change of convention.

Flip both: `entry_date` and `id` **ascending**, opening balance **first**.

**Why:** the page's claim is that the balance is *proved* by the working, and a
proof must be legible in order — opening → bills → receipts → closing, the
arithmetic running down the page. Newest-first scrambles it; the reader has to
work bottom-up to follow the sum. It is also the universal statement-of-account
convention, and it makes the screen and the PDF read the same way instead of
requiring a mental flip between them.

**The cost, accepted:** on a shop with years of entries, oldest-first opens far
from today's activity. What makes that survivable is the filter — the default is
6M and "All" is an explicit opt-in where scrolling is expected. Without the
filter this would be the wrong call.

---

## What is already true — verified 2026-08-04

| | |
|---|---|
| Desktop today | **`@media (min-width: 768px) { .page { padding: 24px } }` and nothing else** |
| `RetailerDetail.module.css` | contains **no `max-width` at all** |
| The component | still carries a future-tense comment at `:227` — *"Desktop gets real Debit and Credit columns instead (step 4)"* |
| PDF stack | `@react-pdf/renderer`, `renderToBuffer`, `export const runtime = "nodejs"` — react-pdf cannot run on edge |
| `pdfMoney()` / `pdfText()` | **local, unexported**, in `src/app/orders/[id]/pdf/PickSlipPdf.tsx` |
| Why `Rs`, not `₹` | react-pdf's built-in fonts are **WinAnsi** — U+20B9 renders as `¹`. Not a style choice |
| Existing PDF route placement | `/orders/[id]/pdf`, a **neutral path**, because middleware fences salesmen out of `/dashboard/*` |
| Ledger RLS | `ledger_entries_select_all` = `auth_profile_role() IS NOT NULL` — **scopes nothing** |

---

## Decisions

### Desktop — the table

**Columns: `DATE · ENTRY · VOUCHER · DR · CR`.** Headers read **`DR`** and **`CR`**,
not "DEBIT"/"CREDIT" — compact, and it matches the `Dr` already on the balance.

Direction comes from **which column a figure sits in**, so no signs and no
colouring of amounts. That is why the phone and desktop genuinely differ: the
phone cannot fit two money columns, so it signs and colours; with voucher types
rendered verbatim, direction has to come from somewhere.

**The opening balance is a row** in the table, dated `—`, so the columns foot.
**The totals row foots both columns** and restates the difference as the same
figure that opens the page — that is the proof, in table form.

**This also closes 🟡 81.** There is currently no `max-width` anywhere, so on a
1400px window every statement row puts its amount a screen-width from the entry
that earns it. A real table fixes that structurally, because the columns do the
aligning. If for any reason the table is not built, a `max-width` is required
instead — shipping neither is not an option, and it is live now.

Use the shared **`src/components/ui/table.module.css`** grammar. Do not start a
fifth table copy; four were just consolidated.

### The filter moves above the heading

Today the chips sit **below** `STATEMENT · since 04 Feb · to today`, so the
caption describes a result before the reader has met the control that produces
it. Controls precede the thing they control. Move the chips above the heading on
both surfaces.

### The export

**Who:** **staff and salesman both** (owner 2026-08-04). The salesman handing a
shopkeeper their statement in the shop is the strongest collection tool on the
page, and it is the shop's own data.

**Therefore the route must sit on a NEUTRAL path** — `/retailers/[id]/statement/pdf`
or similar, **never under `/dashboard/*`**, which middleware fences salesmen out
of. Same reasoning the pick-slip route records for itself.

**It follows the on-screen filter.** Pressing Export while looking at a window
and getting a different one is surprising.

**But the period is CLAMPED TO REAL DATA** (owner 2026-08-04). The header prints
the actual span of rows in the document — "1 May 2026 to 4 Aug 2026" — **never
the filter's nominal start.** The live page currently says *"since 04 Feb"* while
the app holds nothing before 1 May; on screen that is a small overstatement, in a
document sent to a shopkeeper it is a claim about months it has no entries for.
The opening balance accounts for everything before the first row, so the document
is still complete.

**Two deliberate divergences from the screen**, because a document is read
differently:

| | screen | PDF |
|---|---|---|
| opening balance | hidden when zero | **always printed**, even at Rs 0 |
| running balance | none | **a BALANCE column** |

- *Opening always:* on screen a zero opening says nothing. In a document that
  must foot, it is the line that tells the reader **nothing was left out**.
- *Running balance:* on a phone it was two figures per row for a number nobody
  asks. Here the reader is reconciling line by line and there is room.

Order is **no longer a divergence** — both surfaces are oldest-first per decision 1.

**Money renders `Rs 15,064`**, via the pick slip's `pdfMoney()` — which must be
**lifted out of `PickSlipPdf.tsx` and shared**, not copied. Two PDFs with two
private copies of a WinAnsi workaround is exactly how they diverge; the same
lesson `readBalance` already taught. `pdfText()` goes with it.

**Page is A4**, not the pick slip's A5 — this is a table with six columns.

**Contents:** letterhead · *Statement of Account* · shop name, area, phone ·
`Period <first row> to <last row>` · `As per our books as on <balance_as_of>` ·
the table · `BALANCE DUE Rs 15,064 Dr` · footer with the generated timestamp and
page numbers.

---

## Traps

**The route must fetch the RETAILER first and 404 before reading the ledger.**
`ledger_entries_select_all` scopes nothing, so the retailer row is the only
boundary — exactly as the two page routes already do. A PDF route that queries
the ledger by id first would hand any signed-in user any shop's statement as a
downloadable document.

**`export const runtime = "nodejs"`.** react-pdf does not run on edge.

**Do not print `₹` in the PDF.** It renders as `¹`. This is already documented in
`PickSlipPdf.tsx`; do not rediscover it.

**A media query adds no specificity** — the desktop block must sit **below** the
rules it overrides.

**CSS-module class names are not typed.** Grep the stylesheet for every class.

**Delete the stale `(step 4)` comment** at `RetailerDetail.tsx:227` once the
table exists — shipped code pointing at a future step decays into confusion.

`tsc --noEmit` and `eslint src` clean before every commit.
