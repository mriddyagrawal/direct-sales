# BUILDER prompt — ledger page: oldest-first, desktop columns, and the statement PDF

Read **`docs/specs/retailer-ledger-desktop-and-export.md`** and implement it.
That file is the spec; this is how to work. It continues
`docs/specs/retailer-ledger-page.md`, whose **step 4 was never built** — that
branch merged after step 3 and is live on `main` right now.

Design: https://claude.ai/code/artifact/fad886d7-e3f3-4b52-9034-53d5def52b1a

---

## How this run works

**This page is live.** Work on a branch, **do not push**, and after every commit:

1. Commit. **Do not push. Do not merge to `main`.**
2. `npm run dev`, leave it running.
3. Say what changed and what to look at — phone or desktop, which lens.
4. **Stop and wait.**

`npx tsc --noEmit` and `npx eslint src` clean before each commit. Commit messages
must be factually accurate — the REVIEWER checks claims against the diff and
against prod, and has caught two this month that described changes absent from
their own commit.

---

## The four steps

1. **Oldest-first**: flip the query to ascending, move the opening balance to the
   top.
2. **Desktop table**: `DATE · ENTRY · VOUCHER · DR · CR`, opening row, footed
   totals.
3. **Filter chips above the STATEMENT heading**, both surfaces.
4. **Export** → statement-of-account PDF.

---

## One thing you are NOT fixing

Today's ordering is **not a bug**. `fetchRetailerLedger` sorts descending and
`RetailerDetail` renders the opening balance last, with a correct reason written
at the call site: it is the oldest thing on the list, so under newest-first
entries it belongs at the bottom.

That is coherent. **Step 1 is a change of convention the owner asked for**, not a
correction — the opening balance goes to the top, which only works if the entries
run oldest-first. Reword that comment rather than deleting it; the reasoning it
records stays true of the arrangement it describes.

---

## Six things the spec settles — do not re-open

**Oldest-first, because the page is a proof.** Opening → bills → receipts →
closing, arithmetic running down the page. Newest-first scrambles it. It also
makes the screen and the PDF read the same way.

**Desktop columns say `DR` and `CR`**, not DEBIT/CREDIT. Direction comes from
*which column* a figure sits in — so no signs, no colouring of amounts there. The
phone keeps signs and colour because two money columns do not fit. That
divergence is deliberate.

**The desktop table also closes 🟡 81.** There is **no `max-width` anywhere** in
`RetailerDetail.module.css` today, so on a 1400px window every amount sits a
screen-width from the entry that earns it. A real table fixes it structurally. If
the table somehow does not land, a `max-width` is required instead — shipping
neither is not an option, because this is live.

**Export is for staff AND salesman**, so the route sits on a **neutral path** —
never under `/dashboard/*`, which middleware fences salesmen out of. The
pick-slip route records this reasoning for itself; follow it.

**The PDF period is CLAMPED TO REAL DATA** — the actual span of rows in the
document, never the filter's nominal start. The live page says *"since 04 Feb"*
while the app holds nothing before 1 May. Harmless on screen; in a document sent
to a shopkeeper it claims months it has no entries for.

**The PDF always prints the opening balance, even at Rs 0**, and gains a running
BALANCE column the screen does not have. A document has to foot; a phone row does
not.

---

## No DB work — and the RLS trap, again

`ledger_entries_select_all` is `auth_profile_role() IS NOT NULL`. It **scopes
nothing** — every signed-in role can read every entry for every shop.

The two page routes already handle this correctly: retailer first, `notFound()`,
*then* the ledger. **The PDF route must do the same.** A route that queries the
ledger by id first would hand any signed-in user any shop's statement as a
downloadable file — which is worse than the on-screen version, because it leaves
the building.

---

## Traps this project has already paid for

**`export const runtime = "nodejs"`** on the PDF route. react-pdf does not run on
edge.

**Do not print `₹` in a PDF — it renders as `¹`.** react-pdf's built-in fonts are
WinAnsi. `PickSlipPdf.tsx` documents this and works around it with `pdfMoney()`.
**That helper and `pdfText()` are local and unexported — lift them into a shared
module rather than copying.** Two PDFs with two private copies of the same
workaround is precisely how they diverge; `readBalance` already taught this.

**Reuse `readBalance` / `ledgerText`** from `src/lib/balance.ts`, and the shared
`table.module.css` for the desktop table. Four table copies were consolidated
last month; do not start a fifth.

**A media query adds no specificity** — the desktop block goes **below** the
rules it overrides.

**CSS-module class names are not typed.** Grep the stylesheet for every class you
reference; `tsc` will not save you.

**A scripted replace that no-ops looks exactly like one that worked.** Twice in
the last branch. After a scripted edit, read the target back.

**Delete the stale `(step 4)` comment** at `RetailerDetail.tsx:227` once the
table exists.

---

## Constraints

- Money is **paise** — `formatRupees` on screen, `pdfMoney` in the PDF, never
  raw. `outstanding_paise === null` reads "not in the last sync", never ₹0.
- **Think about the phone.** Step 2 is desktop-only by design; nothing about it
  should change the phone, and the phone keeps its signed, coloured amounts.
- The **202 shops with nothing** must still read as ordinary — check the empty
  states survive the reorder, including the "No entries since <date>" case.
