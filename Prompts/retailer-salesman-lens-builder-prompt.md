# BUILDER prompt — the salesman lens on retailer detail (flag 61)

Read **`docs/specs/retailer-detail-salesman-lens.md`** and implement it. That file
is the spec; this is how to work.

---

## How this run works

**The product is live.** One branch, and **nothing is pushed** until the owner
signs off the whole run.

After **every** commit:

1. Commit to the branch. **Do not push. Do not merge to `main`.**
2. `npm run dev`, leave it running.
3. Tell the owner it is up, and say **what changed and what to look at** — which
   page, which role, phone or desktop.
4. **Stop and wait.** Do not start the next step while they are looking.

`npx tsc --noEmit` and `npx eslint src` must both be clean before each commit.
Commit messages must be factually accurate — the REVIEWER verifies claims
literally and flags drift.

---

## The four steps

1. `RetailerDetail` takes a `role` prop. `/dashboard` passes `"staff"`; nothing
   there changes.
2. `src/app/retailers/[id]/page.tsx` — ~25 lines, mirroring `orders/[id]/page.tsx`.
3. `loading.tsx` for the new route.
4. The entry point: `retailerId` into the order query, then the retailer name on
   order detail becomes a lens-aware `<Link>`.

---

## Six things the spec settles — do not re-open

These were each decided by reading the code or querying prod, not by preference.

**The URL is not a security boundary.** RLS is. A salesman gets a 404 on an
inactive shop because `retailers_select_salesman` returns no row and
`maybeSingle()` → `notFound()` — **not** because you wrote a check. Do not add
role guards to the route; add a `role` prop to the component.

**Salesman back destination is `/`, not `/dashboard/retailers`.** They have no
retailers list, and that fallback would drop them in the office shell.

**Edit is hidden on the salesman lens** — the DB already refuses their write, so
the button would only ever produce a raw RLS error. This is also what closes
flag 59.

**`tally_ledger_name` is hidden on the salesman lens.** It is editor-only and
there is no editing here.

**The statement is out of scope and gets no placeholder.** It exists on neither
lens; it lands later on both at once.

**Order detail does NOT currently carry `retailerId`** — only `retailerName`. Step 4
cannot work until `ORDER_DETAIL_SELECT` and `toOrderDetailProps` carry the id.
Check this before designing the link, not after.

---

## Constraints

- **No DB work anywhere.** Every column and policy already exists. If you think
  you need a migration, stop and ask the owner.
- Money is stored in **paise**. Use `formatRupees` (en-IN); never render raw
  paise. `outstanding_paise === null` must read **"not in the last sync"**,
  never ₹0 — 0 is a real, square balance and the two are different facts.
- **Phone layouts are owner-final.**
- Reuse `src/components/ui/table.module.css` and `fab.module.css` if either is
  needed; do not start a new copy. Four table copies and four FAB copies were
  just consolidated, and every one had drifted.

## Two traps this project has already been bitten by

**CSS-module class names are not typed.** `styles.whatever` referencing a class
that does not exist compiles clean and renders unstyled. It has happened twice
here — once in a skeleton, once mid-flight in the balance work. **Grep the
stylesheet for every class you reference**; `tsc` will not save you.

**A media query adds no specificity.** A `@media` rule for a selector placed
*above* that selector's base rule loses the source-order tie and does nothing.
Three live bugs in this codebase came from exactly that — the retailers cards
rendering under the desktop table, Cancel mispositioned on phone, and a nearly
identical near-miss in the Users FAB commit. Media overrides go **below** the
rule they override.
