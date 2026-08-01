# BUILDER prompt — the salesman Retailers tab + the shared retailer row

Read **`docs/specs/salesman-retailers-and-picker-row.md`** and implement it. That
file is the spec; this is how to work.

It **supersedes** `Prompts/quick-order-retailer-row-builder-prompt.md`, which has
been deleted — that task is step 2 here.

---

## How this run works

**The product is live.** One branch, and **nothing is pushed** until the owner
signs off the whole run.

After **every** commit:

1. Commit. **Do not push. Do not merge to `main`.**
2. `npm run dev`, leave it running.
3. Tell the owner it is up, and say **what changed and what to look at** — which
   screen, which role, phone width or desktop.
4. **Stop and wait.** Do not start the next step while they are looking.

`npx tsc --noEmit` and `npx eslint src` clean before each commit. Commit messages
must be factually accurate — the REVIEWER verifies claims literally and flags
drift, including numbers.

---

## The three steps

1. `src/lib/balance.ts` — the shared balance rule. `RetailersQueue` refactored
   onto it, **rendered output byte-identical**. Nothing else changes.
2. `RetailerList` (search + sectioning + rows), and the Quick Order picker adopts
   it. **This is the visible step.**
3. `/retailers` list route + the 4th tab + the `RetailerDetail` fallback fix.

---

## Eight things the spec settles — do not re-open

Each was decided by measuring something or by an explicit owner call.

**The tab order is `Products · Orders · Retailers · Deposits`.** Owner
2026-08-01, who accepted that Orders moves off centre — with four tabs there is
no centre. `.tab` is `flex: 1`, so nothing in the stylesheet assumes three. Icon
is `Store`, already the Retailers icon at `DashboardNav.tsx:24`.

**The list is ALL 599 active shops, not "his" shops.** There is no per-salesman
ownership of retailers in the database — `retailers_select_salesman` is
`active`-only with no salesman predicate — so a "my shops" list would be a
fiction over order history, and it would hide the 516 shops he has never billed.

**Share the LIST, not just the row.** The search predicate and the RECENT/ALL
sectioning are common too, and a duplicated search predicate is the worst thing
here to let drift. The shell and the entire quick-add flow stay per-screen. See
the spec's table for the exact seam.

**Line 2 is conditional on `area || !verified`** — not just `area`, or
quick-added shops silently lose their NEW badge. Nothing is reserved for it; 582
of 599 rows stay exactly as tall as they are today.

**The balance rule is the retailers-queue one, lifted and shared — not copied.**
Red owed, green clear (including ₹0 and credit), uncoloured em dash for null.
`outstanding()` already claims to be the one definition; a third and fourth
private copy makes that comment false.

**No quick-add on the tab, and therefore no FAB.** Adding a shop is part of
taking an order from it. The tab is read-only, exactly like `/products`.

**`/retailers` is a TAB HOME and has NO back arrow.** `TopStrip` above,
`BottomTabBar` below, like `/products` and `/` — neither of which renders a
`BackLink`. It is a destination, not a step in a flow, so there is nothing behind
it. The picker is the opposite case and keeps its `FlowHeader` back with no tab
bar, because it sits *inside* the new-order flow and leaving that flow is what
its back means. Three different shells; do not blur them. The spec tabulates all
three.

**`RetailerDetail`'s salesman fallback becomes `/retailers`.**
`RetailerDetail.tsx:69` has `/` **only because the salesman had no retailers
list**. That premise dies in step 3.

Back is already `contextual` (`28a9303`), so it returns to `previousPathname()`
and **the fallback fires only on a cold load**. Row-tap-to-list and
shop-name-to-order already work through the nav mirror and are untouched here —
do not "fix" the mirror thinking the fallback is what makes them work. Only the
cold-open case moves, from `/` to `/retailers`.

---

## No DB work, and no query change either

`RETAILER_SELECT` and `fetchRetailers` already select every column this needs,
`authenticated` already holds column-level SELECT on `outstanding_paise`, and RLS
is row-level — **the picker already receives the balance and throws it away.**

The `["retailers"]` query key is already prefetched by the picker, so the new tab
shares that cache for free. Mirror `/products/page.tsx` for the page shell.

If you think you need a migration, stop and ask the owner.

---

## Four traps this will walk into

**`align-items: center` is the bug this change produces.**
`PickRetailer.module.css:37` centres the row. The moment the left column becomes
two lines, the amount floats to the vertical middle and stops sharing a baseline
with the name — the right edge visibly wobbles down the list. The amount sits on
**line 1**.

**Nested flex kills the ellipsis unless you set `min-width: 0`.** `.retailerName`
truncates today only because it is a direct flex child. Wrap it in a column and
truncation silently stops — `min-width: auto` refuses to shrink below content
size, so a long name pushes the amount off the row. The longest active shop name
is **44 characters**; this is not hypothetical.

**The picker flow has no width cap and this change is what exposes it.** Staff
reach the same picker from the dashboard FAB. Today the right slot is empty on
97% of rows so nobody notices; put a number there and every row gets a canyon
between name and amount. Cap `.content` and centre it — that stylesheet is
imported by exactly one file.

**CSS-module class names are not typed.** `styles.whatever` on a class that does
not exist compiles clean and renders unstyled. It has happened twice here. Grep
the stylesheet for every class you reference — `tsc` will not save you.

Also: **a media query adds no specificity.** A `@media` block above the rule it
overrides loses the source-order tie and does nothing. Three live bugs here came
from exactly that. Media overrides go **below**.

---

## One thing to hand back rather than decide

**244 of 599 shops owe money — 41% of both lists goes red.** On the office ledger
that is right. Here the salesman is scanning for a *name*, and
`PickRetailer.module.css:55` says so: *"the names are the scan target"*.

Build it coloured. Then **say this out loud when you hand over step 2** and let
the owner judge it on localhost by eye. Do not pre-emptively soften it.

---

## Constraints

- Money is **paise** — `formatRupees` (en-IN), never raw. `null` reads "not in
  the last sync", **never ₹0**.
- **Do not invent a fourth list grammar.** `/products` is the template for the
  tab's shell; the picker's existing sections are the template for the body.
- **Think about the phone.** This is phone-first work, so the phone is primary
  and desktop is the side effect — the reverse of the last few tasks. Work out
  the desktop consequence, decide deliberately, and say what you decided. No
  negative side effects either direction.
