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

**2. Salesman back destination is `/`.** Their retailers list does not exist, so
`/dashboard/retailers` would drop them into the office shell. `/` is also
consistent with `BackLink`'s documented behaviour: it upgrades to
`history.back()` only when the previous page *is* the fallback, and falls
through to a plain link otherwise — the component's own comment calls that the
intended trade for "a detail reached from another detail".

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
- Phone layouts are owner-final.
- `tsc --noEmit` and `eslint src` clean before every commit.
- **CSS-module class names are not typed.** `styles.whatever` on a class that
  does not exist compiles clean and renders unstyled — this has already bitten
  twice in this project. Grep the stylesheet for every class you reference.
