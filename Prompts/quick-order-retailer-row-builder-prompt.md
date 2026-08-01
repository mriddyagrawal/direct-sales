# BUILDER prompt — the Quick Order retailer row: area drops to line 2, balance takes the right

Owner-approved 2026-08-01. **Small, one commit.** Spec is inline — there is no
separate spec file for this one.

**Do this AFTER flag 61 (the salesman lens) is finished and signed off.** Not
alongside it.

**Live product.** Commit, `npm run dev`, tell the owner what to look at, **do not
push**. `npx tsc --noEmit` and `npx eslint src` clean before the commit.

---

## What changes

`RetailerRow` at the bottom of `src/app/new-order/PickRetailer.tsx` is one flex
line today: name left, area + NEW badge right.

It becomes name left / **outstanding balance** right, with the area and the NEW
badge dropping to a **second line that only renders when there is something to
put on it**.

```
Sharma General Store              ₹84,320     ← one line
Gupta Traders                          ₹0     ← one line
Naya Kirana Store                       —     ← two lines
Sector 14 · NEW
```

## Why

The salesman is standing in the shop about to write an order. Whether that shop
owes ₹84,000 is the one fact that should change what he does next, and today he
has to abandon the flow to find it. The owner has already decided salesmen see
balances.

The area moves rather than being dropped because it is *almost never there* —
see the measurements below.

---

## What is already true — verified against prod 2026-08-01, do not re-derive

| | |
|---|---|
| `fetchRetailers` already selects `outstanding_paise` | `src/lib/queries/retailers.ts:33` |
| `RetailerOption = RetailerRow` | so `PickRetailer` **already receives it** |
| Salesman can read the column | `authenticated` has column-level SELECT; RLS is row-level. **The data is already on the wire.** |
| Active shops | **599** |
| Of those, `area IS NULL` | **582 (97%)** — 17 have an area, 0 are empty strings |
| Of the 83 shops ever ordered from, with an area | **15 (18%)** |
| Balances | 244 owed · 325 zero · 28 in credit · **2 null** |
| `PickRetailer.module.css` importers | exactly one — `PickRetailer.tsx` |

**There is no query change and no DB work in this task.** If you think you need
either, stop and ask.

---

## Decisions (settled — build to these)

**1. Line 2 is conditional, and nothing is reserved for it.** No `min-height`,
no placeholder, no empty second line. 582 of 599 rows stay exactly as tall as
they are today.

The owner raised that areas may get filled in later. That was considered and
does not change the answer: conditional line 2 is correct when areas are sparse
(a few tall rows) **and** when they are all filled (every row two lines —
uniform again). Only a half-filled middle looks ragged, and the realistic fill
path is a future sync pulling Tally's ledger address, which flips them all in one
night. If it ever does become annoying, one `min-height` reverses it.

**2. Line 2 renders when `area` is present OR the shop is unverified.** Not just
on `area`. A NEW shop with no area still needs line 2 for the badge. Get this
condition wrong and quick-added shops silently lose their NEW tag.

**3. The balance uses the retailers-queue convention EXACTLY.** Owner: "check out
the admin retailers page, I love that table." The rule lives at
`src/app/dashboard/retailers/RetailersQueue.tsx:36`:

| balance | renders | colour |
|---|---|---|
| `null` | `—` (em dash) | `var(--color-locked)` — grey, **uncoloured on purpose** |
| `<= 0` (includes 0 and credit) | `formatRupees` | `var(--color-processed)` — green |
| `> 0` | `formatRupees` | `var(--color-error)` — red |

Note it is a **binary** test, not a threshold — colour never depends on *how
much* is owed. That is deliberate; credit-limit tiers were dropped 2026-07-31.

`null` must never render as ₹0. Zero is a real, square balance and gets the
green ₹0; null means Tally matched nothing and gets the grey dash.

`--color-error`'s token comment says "errors + Cancelled only — red is
reserved". The owner overrode that for balances on 2026-08-01 and it is already
live on the queue. Do not re-litigate it, and do not introduce a new red.

**4. Share the RULE, not a copy of the function.** `outstanding()` returns a CSS
module class, so it cannot be imported across modules as-is — and its own comment
claims "ONE definition of how a balance reads, so the table and the phone cards
can never disagree". A third surface with a private copy makes that comment a
lie.

Lift the decision into a shared module (e.g. `src/lib/balance.ts`) that returns a
**semantic state plus the text** — something like `"owed" | "clear" | "unknown"`
and the formatted string. Each surface then maps that state to its own local
class. `RetailersQueue`'s `outstanding()` becomes a thin mapping over the shared
rule and its rendered output must not change. The picker gets its own three
classes pointing at the same tokens.

**5. Money is paise.** `formatRupees` (en-IN), never raw.

---

## Four traps, in the order they will bite you

**1. `align-items: center` is the bug this change produces.**
`.retailerRow` is centred today (`PickRetailer.module.css:37`). The moment the
left column becomes two lines, the amount floats to the vertical middle and stops
sharing a baseline with the name — the right edge visibly wobbles down the list.
The amount must sit on **line 1**, aligned with the name.

**2. Nested flex kills the ellipsis unless you set `min-width: 0`.**
`.retailerName` truncates today because it is a direct flex child. Wrap it in a
new left column and truncation silently stops working — the default
`min-width: auto` refuses to shrink below content size, so a long name pushes the
amount off the row instead of ellipsising. The longest active shop name is **44
characters**, so this *will* happen on a phone, not just in theory. Set
`min-width: 0` on the left column.

**3. The flow has no width cap, and this change is what exposes it.**
`.content` is uncapped, so on desktop — where staff reach this same picker from
the dashboard FAB — the row is as wide as the window. Today the right slot is
empty on 97% of rows so nobody notices. Put a number there and every row gets a
canyon between name and amount. Cap `.content` and centre it. The stylesheet is
imported by one file, so this cannot leak; and a `max-width` cannot affect the
phone, which is below it.

**4. `.retailerMeta` has `flex-shrink: 0`** and is currently the right-hand
sibling. You are restructuring it into line 2 — check nothing else depends on
that class before you repurpose it, and delete it if it ends up unused rather
than leaving a dead rule.

---

## One thing to hand back to the owner rather than decide

**244 of 599 shops owe money — 41% of the list will be red.** On the ledger that
is right; you go there to look at balances. Here the salesman is scanning for a
*name*, and the stylesheet says so explicitly at `PickRetailer.module.css:55`:
"the names are the scan target". A wall of red down the right edge may compete
with that.

Build it coloured per decision 3. Then **say this out loud when you hand it
over** and let the owner judge it on localhost by eye — it is a density question,
not an argument question. Do not pre-emptively soften the colour.

---

## Constraints

- **No DB work. No query change.** Every column is already fetched.
- Search behaviour is unchanged — it still matches name + area. The area simply
  renders in a different place.
- The quick-add form and its duplicate-clash card are **out of scope**. Do not
  touch them.
- **Think about the phone.** This flow is phone-first, so the phone *is* the
  primary surface here and desktop is the side effect — the reverse of the last
  few tasks. Work out what the desktop consequence is, decide deliberately, and
  say what you decided. No negative side effects either direction.
- **CSS-module class names are not typed.** `styles.whatever` on a class that
  does not exist compiles clean and renders unstyled — this has bitten this
  project twice. Grep the stylesheet for every class you reference.
- **A media query adds no specificity.** A `@media` block above the rule it
  overrides loses the source-order tie and does nothing. Three live bugs here came
  from exactly that. Media overrides go **below**.
