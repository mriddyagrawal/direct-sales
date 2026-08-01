# BUILDER task — the salesman lens on retailer detail (flag 61)

Owner-approved 2026-08-01. **No DB work.** Every column and policy this needs
already exists. If you think you need a migration, stop and ask.

**Live product. One branch, commit after each step, do NOT push.** Run
`npm run dev`, say what changed and what to look at, and wait for the owner
before the next step. Same loop as the table-standardisation run.

---

## Why

`src/app/retailers/` does not exist. A salesman **cannot reach retailer detail
at all** — not in the wrong shell, not with the wrong buttons. There is no
route.

That became real rather than theoretical when `ed8d30e` shipped the outstanding
balance to the retailers list, and the owner has already decided salesmen see
the balance and the statement.

## The template — read this before designing anything

Orders solved this exact problem and the answer is **not** "one page with role
checks". Measured:

```
OrderDetailView.tsx        1095 lines   the entire UI, shared
order-detail-data.ts        137 lines   ORDER_DETAIL_SELECT + toOrderDetailProps, shared
orders/[id]/page.tsx         35 lines   salesman
dashboard/orders/[id]/…      37 lines   staff
```

The two route files run the **same query** and differ in two things: the `role`
prop they pass, and the staff one additionally reading `profiles.role` for
`isAdmin` (Approve is admin-only).

**The URL is not a security boundary, and must not be treated as one.** The
salesman page's own comment says it: *"RLS scopes it to his own orders (anyone
else's id → no row → 404)."* The 404 comes from RLS returning nothing into
`maybeSingle()`, never from a route check. What the URL selects is:

1. **the shell** — `/dashboard/*` is wrapped by `dashboard/layout.tsx` →
   `DashboardNav`; salesman routes sit under the root layout;
2. **a `role` prop** driving show/hide inside the shared component.

Retailers gets the same treatment. `RetailerDetail`, its query and its RLS
scoping already exist, so this is small.

---

## What is already true (verified, do not re-derive)

| | |
|---|---|
| `RetailerDetail` props | `{ retailer }` only — **no role concept yet** |
| Its BackLink | hardcoded `fallback="/dashboard/retailers"` |
| Salesman RLS on retailers | `retailers_select_salesman` — **active shops only** |
| Salesman UPDATE | refused: `retailers_staff_update` is accountant/admin |
| Salesman entry point | **none exists** |
| Order detail's retailer data | `retailerName` only — **`retailerId` is NOT in the query** |

---

## Decisions (settled — build to these)

**1. Add a lens prop, do not fork the component.** `RetailerDetail` takes a
`role: "salesman" | "staff"`. One component, one query, exactly as orders does.

**2. Back is CONTEXTUAL, the label is always the single word "Back", and it uses
the existing nav mirror — NOT a `?from=` query param.** (Owner 2026-08-01.)

The deciding journey is the admin's: approve an order → open the shop to check
whether it is creditworthy → return to that order. A hierarchical back landing
on the retailers list breaks that loop on **every** order, and it is the main
journey rather than an edge case.

`?from=` was the obvious mechanism and is **not** what to build. `src/lib/nav-history.ts`
already does this properly:

- **module-level, per-tab, reset on any hard load** — so a cold load (a link
  opened from WhatsApp) has an empty stack, `previousPathname()` returns null,
  and Back falls through to the lens default. The case that defeats a blind
  `router.back()` is already handled.
- **popstate-aware** — a back traversal *pops* the mirror rather than pushing,
  so the `detail ‹ scan ‹ detail` cycle the owner reproduced in 2026-07 is
  solved **at the mirror**, not by avoiding `router.back()`.

**Why the label change is what makes this viable.** `BackLink` only upgrades to
`router.back()` when `previousPathname() === fallback` — a strict check that
back lands where *the arrow promises*, which exists because the label names a
destination (`‹ Retailers`). With the label reduced to **"Back"**, the arrow
promises no particular screen, so "return to wherever you came from" is coherent
and the strict check stops earning its keep.

Build it as: decide **in the click handler**, never during render —
`previousPathname()` is client-only module state and reading it while rendering
would hydrate differently from the server. `href={fallback}` stays the lens
default (`/dashboard/retailers` for staff, `/` for the salesman, who has no
retailers list) so SSR, modified clicks and no-JS all still land somewhere real.

**Accepted cost:** the strict check was also what kept a *drifted* mirror safe —
the module's own comment notes it can diverge on a forward button or an
unexpected traversal, after which BackLink used to fall through to the plain
link. Loosened, a drifted mirror sends the user to an unexpected in-app page
instead. Rare, and the failure is "a different app screen", not a broken state.

**Do NOT add a `?from=` param.** It would work, but it puts an
attacker-controlled path in the URL (needing the same validation as `safeNext`),
pollutes shareable links with their origin, and duplicates a mechanism this
codebase already has and has already debugged twice.

**3. Edit is staff-only.** Hide it on the salesman lens. Not because it is
unsafe — `retailers_staff_update` already refuses their write — but because an
affordance that fails with a raw RLS error is worse than no affordance. This is
what also closes flag 59: Edit hides because the component knows the role, not
because a guard blocks the page.

**4. `tally_ledger_name` is hidden on the salesman lens.** It is editor-only
(owner 2026-08-01, 596 of 599 identical to the name). With no editing on this
lens there is nothing for it to serve.

**5. The statement is OUT OF SCOPE and no gap is left for it.** It exists on
neither lens today. Build the route with the fields that exist now; the
statement lands later on both lenses at once. Do not scaffold an empty section
for something unspecced.

**6. The entry point is the retailer name on order detail** — and it needs the
query widened. `toOrderDetailProps` maps `row.retailers?.name` and **never
carries the id**, so `ORDER_DETAIL_SELECT` and the props type both need
`retailerId` before the name can become a link. Route it by lens:
salesman → `/retailers/[id]`, staff → `/dashboard/retailers/[id]`, the same
`detailBase` idiom already used at `new-order/page.tsx:84` and
`scan/[id]/page.tsx:35`.

---

## Steps

**1 — `RetailerDetail` takes a `role` prop.** Existing `/dashboard` route passes
`role="staff"`; behaviour there is unchanged. Edit, the Tally ledger row and the
BackLink fallback all key off it. Nothing new renders yet.

**2 — `src/app/retailers/[id]/page.tsx`.** ~25 lines, mirroring
`orders/[id]/page.tsx`: async `params`, server client, the same select,
`maybeSingle()` → `notFound()`, render `RetailerDetail` with `role="salesman"`.
An inactive shop 404s for them automatically — that is RLS, not a check you write.

**3 — `loading.tsx` for the new route.** Copy the shape of
`dashboard/retailers/[id]/loading.tsx`. For a dynamic route the loading boundary
is *what `<Link>` prefetches*, so without it the tap pays full latency.

**4 — The entry point.** Add `retailerId` to `ORDER_DETAIL_SELECT` and
`toOrderDetailProps`, then make `order.retailerName` in `OrderDetailView` a
`<Link>` whose base comes from the lens. Staff behaviour must not change.

---

## Constraints

- **No DB work.** `outstanding_paise`, `balance_as_of`, `tally_ledger_name` and
  every policy already exist.
- Money is **paise**; convert with `formatRupees` (en-IN) and never render raw.
  `outstanding_paise === null` reads **"not in the last sync", never ₹0**.
- **Phone: settled is not the same as untouchable.** (Owner 2026-08-01, correcting
  a rule the REVIEWER had inflated.) What was actually decided is narrow: the
  **Orders** phone layout — sticky chips, tuned padding — is an owner decision
  and is not to be redesigned. That got restated slightly wider across several
  documents until it read as "never change a phone screen", and it cost a real
  hesitation on a real bug: flag 63, where the last row sat underneath the FAB
  on three pages, was left unfixed on those grounds until the owner overrode it.

  The rule to work to:
  - **A phone bug is a bug.** Fix it. Nothing about the phone is exempt from
    correctness.
  - **Desktop work must not change the phone as a side effect.** Touching a
    desktop table should leave the phone cards byte-identical unless you meant
    otherwise.
  - **But a desktop change usually HAS a phone counterpart.** Decide about it
    deliberately and say what you decided. "Desktop-only" is a choice to state,
    not a default to assume.
- `tsc --noEmit` and `eslint src` clean before every commit.
- **CSS-module class names are not typed.** `styles.whatever` on a class that
  does not exist compiles clean and renders unstyled — this has already bitten
  twice in this project. Grep the stylesheet for every class you reference.
