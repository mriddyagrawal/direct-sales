# Builder prompt — `loading.tsx` skeletons on every route (instant navigation feedback)

**Goal:** kill the "press → freeze → snap-in ~2s later" feel. In the App Router, a route
**without** a `loading.tsx` freezes the current screen until the server render finishes; a
route **with** one shows a skeleton **instantly** (inside the persistent shell) while the
server works. Only **2 of 13** routes have one today — add skeletons to the other **11**.
This is **presentation-only** — no data, logic, RLS, RPC, or money surface. Safe to ship on
live prod (it only changes what renders *during* a navigation). Phase 6 item #1
([PLAN.md](../PLAN.md), [docs/future-plans.md](../docs/future-plans.md)).

## The 11 routes that need a `loading.tsx` (2 already have one — mirror them)
Existing pattern to follow: [src/app/loading.tsx](../src/app/loading.tsx) +
`loading.module.css` and [src/app/dashboard/loading.tsx](../src/app/dashboard/loading.tsx)
— **skeletons, never spinners** (design spec S2/S8). Add a sibling `loading.tsx` in each of:

| Route | Shape the skeleton should roughly match |
|---|---|
| `src/app/new-order/` | Quick Order — a search bar + a list of ~6 product-row skeletons |
| `src/app/orders/[id]/` | Order detail — header (ref + retailer), 3–4 item rows, a total bar, a few history lines |
| `src/app/dashboard/orders/[id]/` | Same detail shape as above (shared `OrderDetailView`) |
| `src/app/dashboard/products/` | Table/list — a header + ~8 row skeletons |
| `src/app/dashboard/retailers/` | Table/list — a header + ~8 row skeletons |
| `src/app/dashboard/users/` | List — a header + ~5 row skeletons |
| `src/app/godown/` | Pickup queue — ~5 card skeletons |
| `src/app/godown/[id]/` | Pick/scan — a header + one large block (camera area) + 2 line skeletons |
| `src/app/scan/[id]/` | Same pick/scan shape as `godown/[id]` |
| `src/app/deposits/` | Trivial — a centered block or two (it's a static "Coming soon" page); keep it minimal |
| `src/app/login/` | **Optional / skip** — static pre-auth form, renders instantly; a skeleton flash here adds little. Builder's call. |

## Approach
- **Prefer a shared skeleton primitive** to avoid 11 bespoke CSS files: add a small
  `src/components/ui/Skeleton.tsx` + `Skeleton.module.css` — a single pulsing block
  (a `@keyframes` opacity/shimmer using existing tokens like `--color-hairline`), with
  props for width / height / radius (or a `variant`: `line | card | block`). Each route's
  `loading.tsx` composes page-shaped skeletons from it. *(Optionally migrate the existing 2
  to it — nice-to-have, not required.)*
- **Render within the route's layout/shell.** `loading.tsx` is the Suspense fallback for the
  *page* inside its `layout.tsx`, so the top strip / bottom nav stay mounted automatically —
  good. Make the skeleton sit in the **same container/padding as the real content** (respect
  the app-shell pattern: pages like `/` use a `height:100dvh` flex shell with a `.content`
  scroll area — the skeleton should fill that content region, not a bare page) so the swap
  from skeleton → real content doesn't jump.
- **Keep it light** — a handful of pulsing blocks, subtle animation, existing colors. No
  spinners, no layout shift, no data fetching in `loading.tsx` (it must render instantly).

## Acceptance (reviewer verifies)
- Navigating to **each** of the 11 routes shows a skeleton **immediately** on tap (no frozen
  delay on the previous screen), then the real content replaces it — verify on a throttled
  connection / by eye that the click feels instant.
- The persistent shell (top strip, bottom nav) stays put during the skeleton phase (no
  full-page flash).
- Skeletons roughly match each page's shape (no big jump when real content lands); no CLS/
  layout shift.
- Skeletons, **not** spinners; uses existing design tokens; no data/logic/RLS/RPC touched.
- `npm run build` + `tsc` + eslint clean.

## Guardrails
- **Presentation-only.** `loading.tsx` files (+ an optional shared `Skeleton` component) only.
  Do NOT change any page's data fetching, queries, RPCs, RLS, or business logic.
- No data fetching or async work inside a `loading.tsx` — it must render synchronously/instantly.
- Reuse the existing skeleton look (mirror `src/app/loading.tsx`); don't introduce a spinner.
- Don't regress the 2 existing loading states.
