# The salesman Retailers tab + the shared retailer row

Owner-approved 2026-08-01. **No DB work.** Every column, policy and query this
needs already exists. If you think you need a migration, stop and ask.

Supersedes `Prompts/quick-order-retailer-row-builder-prompt.md`, which described
the picker change alone. It is step 2 here. That file is deleted; this is the
spec.

---

## Why

Two things landed on the same row at the same time:

1. The Quick Order picker shows **name left, area right**. The area is the wrong
   thing on the right — see the measurements — and the balance is the right one.
   A salesman about to write an order should be able to see that the shop owes
   ₹84,000 without leaving the flow.
2. The salesman is getting a **Retailers tab** (owner 2026-08-01).

Those are the same row: name, area, balance, searchable, tappable. Only the tap
differs. This project has just spent a seven-step run consolidating four drifted
`.table` copies and four drifted FAB copies — **build the row once**, before
there are two of it.

---

## What is already true — verified against prod and the repo 2026-08-01

Do not re-derive any of this.

| | |
|---|---|
| Active shops | **599** |
| …with `area IS NULL` | **582 (97%)** — 17 have one, 0 are empty strings |
| Shops ever ordered from | **83**, of which **15** have an area |
| Balances | 244 owed · 325 zero · 28 in credit · 2 null |
| Longest active shop name | **44 characters** |
| `outstanding_paise` reachable by a salesman | **yes** — `authenticated` holds column-level SELECT and RLS is row-level. The picker **already receives it** and throws it away |
| The query | `RETAILER_SELECT` + `fetchRetailers` already select every needed column |
| The cache | the picker already prefetches the `["retailers"]` key — **the tab shares it for free** |
| `.tab` in `BottomTabBar.module.css` | `flex: 1` — **no 3-tab assumption**, a 4th just divides the width |
| The Retailers icon | `Store` from lucide — already used at `DashboardNav.tsx:24`. Reuse it |
| `BottomTabBar` renderers | `/`, `/products`, `/deposits` — the new route must render it too |
| The template | `/products` — *"a pricelist + stocklist + search he can pull up mid-conversation — no retailer, no cart, no editing"* |

---

## Decisions (settled — build to these)

**1. Nav: `Products · Orders · Retailers · Deposits`.** Owner 2026-08-01. Orders
moves from centre to 2nd, which the owner accepted explicitly — with four tabs
there is no centre, and this keeps Orders nearest to where the thumb already
goes. Icon is `Store`, matching the office nav.

**2. The list is ALL active shops, recent-first — not "his" shops.** Owner's
reason, and it is the right one: **there is no per-salesman ownership of
retailers in the database at all.** Every salesman sees every active shop
(`retailers_select_salesman` is `active`-only, with no salesman predicate). A
"my shops" list would be a fiction assembled from order history, and it would
hide the 516 shops he has never billed — exactly the ones he might be walking
into. Same RECENT / ALL SHOPS shape the picker already uses, so both screens read
the same way.

**3. Share the LIST, not just the row — and be explicit about where the seam is.**

The two screens have more in common than the row. Measured against
`PickRetailer.tsx` (~200 lines):

| | |
|---|---|
| The search predicate — `matches()`, name+area, lowercased | **shared** |
| The RECENT / ALL SHOPS split and the `localeCompare` sort | **shared** |
| The row — name, area, NEW, balance | **shared** |
| Quick-add screen + duplicate-clash card (~45 lines) | **picker only** |
| The shell — `FlowHeader` vs `TopStrip` + `BottomTabBar` | **per screen** |
| The tap — `onSelect` advances the flow vs `<Link>` navigates | **per screen** |

So build a **`RetailerList`** that owns the search field, the filter, the
sectioning and the rows, and takes the tap behaviour as a prop (an `onSelect`
callback **or** an href builder — one or the other, not both). Roughly half of
`PickRetailer` moves into it.

**Sharing only the row would leave the search predicate duplicated, and that is
the worst thing here to let drift** — "why does search behave differently on the
two screens?" is a bug nobody files and everybody notices.

**What stays OUT of the shared component, deliberately:** the page shell, and the
whole quick-add flow. Those genuinely differ, and pulling them in would mean a
component that renders a `FlowHeader` on one screen and a tab bar on the other —
which is how a shared component turns into a switchboard. Each screen keeps its
own shell and passes the list its children.

The picker's empty state (*"No shops match → + Add it as a new shop"*) is
picker-only for the same reason. Give `RetailerList` an optional slot for it
rather than teaching the component about quick-add.

**4. Layout: name + balance on line 1; area and the NEW badge drop to line 2,
which renders only when there is something to put on it.**

```
Sharma General Store              ₹84,320     ← one line
Gupta Traders                          ₹0     ← one line
Naya Kirana Store                       —     ← two lines
Sector 14 · NEW
```

**Line 2's condition is `area || !verified`, not just `area`.** A quick-added
shop with no area still needs the badge. Get this wrong and NEW silently
disappears.

**Nothing is reserved for line 2** — no `min-height`, no placeholder. 582 of 599
rows stay exactly as tall as they are today.

The owner raised that areas may be filled in later. Considered, and it does not
change the answer: conditional line 2 is correct when areas are sparse (a few
tall rows) **and** when they are all filled (every row two lines — uniform
again). Only a half-filled middle looks ragged, and the realistic fill path is a
future sync pulling Tally's ledger address, which flips them all in one night. If
it ever does become annoying, one `min-height` reverses it — so decide on
today's data, not a forecast.

**5. The balance uses the retailers-queue convention EXACTLY.** Owner: *"check
out the admin retailers page, I love that table."* The rule lives at
`RetailersQueue.tsx:36`:

| balance | renders | colour |
|---|---|---|
| `null` | `—` (em dash) | `var(--color-locked)` — grey, **uncoloured on purpose** |
| `<= 0` (includes 0 and credit) | `formatRupees` | `var(--color-processed)` — green |
| `> 0` | `formatRupees` | `var(--color-error)` — red |

It is a **binary** test, not a threshold — colour never depends on *how much* is
owed. Credit-limit tiers were deliberately dropped 2026-07-31.

`null` must never render as ₹0. Zero is a real, square balance and gets the green
₹0; null means Tally matched nothing.

`--color-error`'s token comment says *"errors + Cancelled only — red is
reserved"*. The owner overrode that for balances on 2026-08-01 and it is already
live on the queue. Do not re-litigate it and do not introduce a second red.

**6. Share the RULE, not a copy of the function.** `outstanding()` returns a CSS
module class, so it cannot be imported across modules as-is — and its own comment
claims *"ONE definition of how a balance reads, so the table and the phone cards
can never disagree."* A third and fourth surface with private copies make that
comment a lie.

Lift the decision into a shared module (e.g. `src/lib/balance.ts`) returning a
**semantic state plus the text** — `"owed" | "clear" | "unknown"` and the
formatted string. Each surface maps the state to its own local class.
`RetailersQueue`'s `outstanding()` becomes a thin mapping over it and **its
rendered output must not change**.

**7. No quick-add on the tab.** It stays in the picker, where it belongs —
adding a shop is part of taking an order from it, and a shop added while browsing
has no order to attach to. The tab is read-only, exactly like `/products`. This
also means the tab needs **no FAB**, so it needs none of the FAB clearance work
from flag 63.

**8. `RetailerDetail`'s salesman back fallback changes `/` → `/retailers`.**
`RetailerDetail.tsx:69` reads `fallback={isStaff ? "/dashboard/retailers" : "/"}`
and the `/` is there **only because the salesman had no retailers list**. That
premise dies with this spec.

**Be precise about what this does and does not change.** Back is already
`contextual` (shipped in `28a9303`), so it returns to `previousPathname()` — the
fallback is used **only on a cold load**, when the nav mirror is empty. So:

| how he got there | where back goes | via |
|---|---|---|
| tapped a row on `/retailers` | the retailers list | the mirror |
| tapped the shop name on order detail | that order | the mirror |
| opened the link cold, e.g. from WhatsApp | `/retailers` (was `/`) | **the fallback** |

The first two already work and are unaffected by this change — that "back goes
wherever I came from" behaviour is exactly what `contextual` bought. Only the
third row moves, and `/retailers` is the better landing because it is the list
that contains the shop he was looking at.

**9. Search is unchanged** — it matches name + area, as the picker already does.
The area simply renders in a different place.

---

## Steps

**1 — `src/lib/balance.ts` + `RetailersQueue` onto it.** The shared rule, one
consumer. `RetailersQueue`'s rendered output must be **byte-identical** after
this step — it is a refactor, not a redesign. Nothing else changes.

**2 — `RetailerList` (search + sections + rows), and the picker adopts it.**
Extract from `PickRetailer` rather than writing fresh — the predicate and the
sectioning already work and are already the agreed behaviour. This is the step
with a visible change: the picker gets the new layout and the balance. The owner
reviews the density here — see below.

Leave `PickRetailer` owning its `FlowHeader`, its quick-add screen and its empty
state; it should end up noticeably shorter, not merely rearranged. If it did not
shrink, the seam is in the wrong place.

**3 — `/retailers` list route + the 4th tab + the fallback fix.** Mirror
`/products/page.tsx`: auth check, `getQueryClient()`, prefetch `fetchRetailers`
under `["retailers"]`, `TopStrip` + `BottomTabBar`, `HydrationBoundary`, client
list component. Add the `Store` tab to `BottomTabBar` in position 3. Apply
decision 8.

**`/retailers` is a TAB HOME, so it has NO back arrow** — `TopStrip` above,
`BottomTabBar` below, exactly like `/products` and `/` (owner 2026-08-01, and
confirmed against both: neither renders a `BackLink`). The three shells in play
are genuinely different and must not be blurred:

| screen | reached by | shell |
|---|---|---|
| `/retailers` (list) | tapping the tab | `TopStrip` + `BottomTabBar`, **no back** |
| picker (`PickRetailer`) | New Order → step 1 of a flow | `FlowHeader` with back, **no tab bar** |
| `/retailers/[id]` (detail) | a row, or the shop name on order detail | contextual `BackLink`, no tab bar |

The picker keeps its back and stays tab-bar-free because it sits *inside* the
new-order flow — leaving the flow is what its back means. The list is a
destination, not a step, so there is nothing behind it to go back to.

---

## Four traps, in the order they will bite

**1. `align-items: center` is the bug this will produce.** `.retailerRow` is
centred today (`PickRetailer.module.css:37`). The moment the left column becomes
two lines, the amount floats to the vertical middle and stops sharing a baseline
with the name — the right edge visibly wobbles down the list. The amount must sit
on **line 1**.

**2. Nested flex kills the ellipsis unless you set `min-width: 0`.**
`.retailerName` truncates today because it is a direct flex child. Wrap it in a
new left column and truncation silently stops — the default `min-width: auto`
refuses to shrink below content size, so a long name pushes the amount off the
row instead of ellipsising. The longest active shop name is **44 characters**, so
this *will* happen on a phone.

**3. The picker flow has no width cap, and this change is what exposes it.**
`PickRetailer.module.css`'s `.content` is uncapped, so on desktop — where staff
reach the picker from the dashboard FAB — the row is as wide as the window. Today
the right slot is empty on 97% of rows so nobody notices; put a number there and
every row gets a canyon. Cap `.content` and centre it. That stylesheet is
imported by exactly one file, so it cannot leak.

**4. `.retailerMeta` has `flex-shrink: 0`** and is currently the right-hand
sibling. You are restructuring it into line 2 — delete it if it ends up unused
rather than leaving a dead rule.

---

## One thing to hand back to the owner rather than decide

**244 of 599 shops owe money — 41% of both lists will be red.** On the office
ledger that is right; you go there to look at balances. Here the salesman is
scanning for a *name*, and `PickRetailer.module.css:55` says so explicitly: *"the
names are the scan target"*.

Build it coloured per decision 5. Then **say so when handing over step 2** and let
the owner judge it on localhost by eye. It is a density question, not an argument
question. Do not pre-emptively soften the colour.

---

## Constraints

- **No DB work. No query change.** Every column is already fetched and already
  reaches the salesman.
- Money is **paise** — `formatRupees` (en-IN), never raw. `outstanding_paise ===
  null` reads "not in the last sync", **never ₹0**.
- **Do not invent a fourth list grammar.** `/products` is the template for the
  tab's page shell; the picker's sections are the template for the list body.
- **Think about the phone.** This flow is phone-first, so the phone is the
  primary surface and desktop is the side effect — the reverse of the last few
  tasks. Work out the desktop consequence, decide deliberately, say what you
  decided.
- **CSS-module class names are not typed.** `styles.whatever` on a class that
  does not exist compiles clean and renders unstyled — this has bitten this
  project twice. Grep the stylesheet for every class you reference.
- **A media query adds no specificity.** A `@media` block placed above the rule
  it overrides loses the source-order tie and does nothing. Three live bugs here
  came from exactly that. Media overrides go **below**.
- `tsc --noEmit` and `eslint src` clean before every commit.
