# BUILDER prompt — the retailer detail page becomes the Tally ledger

> **⚠️ DONE — DO NOT BUILD FROM THIS FILE.**
> Steps 1–3 shipped and merged to `main` (`6de4175`, live).
> **Step 4 was never built** and has moved, with three additions, to
> **`Prompts/retailer-ledger-desktop-and-export-builder-prompt.md`**.
> Kept as the record of what steps 1–3 were built against.

Read **`docs/specs/retailer-ledger-page.md`** and implement it. That file is the
spec; this is how to work. The rendered design is at
https://claude.ai/code/artifact/fad886d7-e3f3-4b52-9034-53d5def52b1a

---

## How this run works

**The product is live and this page is already shipped**, so work on a branch and
**do not push** until the owner signs off.

After **every** commit:

1. Commit to the branch. **Do not push. Do not merge to `main`.**
2. `npm run dev`, leave it running.
3. Say **what changed and what to look at** — which lens, phone or desktop.
4. **Stop and wait.**

`npx tsc --noEmit` and `npx eslint src` clean before each commit. Commit messages
must be factually accurate — the REVIEWER verifies claims literally, against the
diff and against prod, and has caught two commits this month asserting changes
that were not in them.

---

## The four steps

1. `src/lib/queries/ledger.ts` + `balance_as_of` into `RETAILER_SELECT`.
2. The page, phone-first: fact table out, claim + statement + proof in.
3. The since-filter, wired to both the query and the opening-balance derivation.
4. Desktop: full width, Debit/Credit columns, footed totals.

---

## The one idea to build around

**The balance is stated at the top and proved at the bottom** — the same figure
twice, with the entries between as the working. The closing total gets the **2px
ink rule** because it is a QED, not another row.

If a detail seems arbitrary, check it against this. Most of them follow from it,
including why the filter cannot be a from/to range.

---

## Seven things the spec settles — do not re-open

**Voucher types are VERBATIM.** `Rcpt G Type`, `SALES C TYPE`, `Bajaj Sales` —
Tally's exact strings and casing. Translating them was tried and was **wrong**:
`Ganpati Payment` is 30 entries, all **debits**, so "Receipt" would have shown
money owed as money received. The page must be holdable beside Tally.

**The filter is SINCE, never from–to.** `3M · 6M · This FY · All`, default 6M.
A from/to range breaks the proof, because the closing figure of a past window is
not the current outstanding. "This FY" is April–March — `_fy_start()` in
`tally-agent/ledger_sync.py` already computes it; mirror that.

**The opening balance is the first ROW, not a footer**, labelled with the
filter's start date, derived client-side as
`outstanding − Σ(debit − credit)` over the shown entries. It **moves when the
filter moves** — that is correct. Render it only when non-zero; 112 of 395 shops
reconcile on their own and the row would say nothing.

**No fact table.** Area and phone are one line under the name, absent when empty
— **582 of 600 shops have no area**. Phone is a `tel:` link.

**The Tally ledger name shows only on an UNSYNCED shop**, where it is the
diagnosis. It is identical to the shop name on 596 of 599; everywhere else it is
noise and belongs in the Edit modal.

**Desktop is full width with Debit/Credit COLUMNS**, phone signs-and-colours.
That divergence is deliberate: two money columns do not fit a phone, and with
voucher types no longer saying "Receipt", direction has to come from somewhere.

**The salesman sees the full statement.** Only Edit and the Tally name are
staff-only.

---

## No DB work — and the RLS trap

The table, the rows and the policy all exist. **But `ledger_entries_select_all`
is `auth_profile_role() IS NOT NULL`** — every signed-in role can read every
entry for every shop. It hides nothing.

So the page's 404 must keep coming from the **retailer** query, exactly as it
does now: `retailers_select_salesman` is active-only → `maybeSingle()` →
`notFound()`. **Fetch the retailer first; if it 404s, never fetch the ledger.**
Do not add a role check to the route — RLS on the retailer row is the boundary,
not the URL.

If you think you need a migration, stop and ask the owner.

---

## Traps this project has already paid for

**Reuse `readBalance` and `ledgerText` from `src/lib/balance.ts`.** Four surfaces
share them. Do not write a fifth reading of a balance.

**Owed is RED here.** The blue on the picker and Retailers tab is the *leak* rule
— see `.balanceOwed`'s comment in `OrderDetailView.module.css`, which states the
test and why this page is on the other side of it.

**Money is paise** — `formatRupees` (en-IN), never raw. `outstanding_paise ===
null` reads "not in the last sync", **never ₹0**.

**CSS-module class names are not typed.** `styles.whatever` on a class that does
not exist compiles clean and renders unstyled. It has happened twice here. Grep
the stylesheet for every class you reference — `tsc` will not save you.

**A media query adds no specificity.** Media overrides go **below** the rule they
override; three live bugs here came from getting that backwards.

**A scripted replace that no-ops looks exactly like one that worked** — twice in
the last branch, once shipping a commit message that described a change absent
from its own diff. After a scripted edit, read the target back.

**Flex row height is set by its tallest child, not by padding.** Three wrong
measurements in the last branch came from forgetting it.

---

## Constraints

- **Think about the phone.** It is the primary surface here; desktop is the one
  that changes shape. Work out both, decide deliberately, say what you decided.
- **Do not invent a new list grammar.** The shared `table.module.css` is the
  desktop table's home; the phone statement is a list of hairline rows like the
  ones this page and the retailer lists already use.
- The **202 shops with nothing** must read as ordinary, not broken — every
  heading stays and says plainly what is missing.
