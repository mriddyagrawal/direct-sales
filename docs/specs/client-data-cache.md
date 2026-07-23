# Client data cache — "instant tabs" (Phase 6 · Slice B)

**Status:** spec for owner review, 2026-07-24 · **Author:** REVIEWER, with the owner
**Parent plan:** [future-plans.md §App feel & performance](../future-plans.md) / PLAN.md Phase 6 item ② ("cache everything except the data" — owner 2026-07-11)
**Ground rule:** FE-only. No DB change, no RLS change, no new server privileges. The server stays the only source of truth.

## Problem

Every tab tap re-runs the full server pipeline (auth round-trip + role query + the page's DB queries) before anything paints. Skeletons (Phase 6 ①) made the wait *visible*; nothing yet made it *short*. A revisited tab knows nothing from the last visit.

## Approach — two memory layers, network stays the truth

**Layer 1 — screen snapshot (Next.js router cache).** Configure `staleTimes` so a *client-side* revisit to a recently seen page repaints the **last rendered screen instantly** instead of waiting for the server. In-memory, per-tab, gone on hard reload.

**Layer 2 — data cache (TanStack Query v5).** The hot lists move their data into client queries seeded by the server render. On every mount the cached list paints **immediately** and a background refetch fires; fresh results are applied **in place** (rows appear/change/vanish; counts tick — no reload, no flash). This is the classic *stale-while-revalidate* pattern.

Layer 1 makes the page appear instantly; Layer 2 makes the data on it correct itself within ~a second. First visits and hard reloads behave exactly as today (server-rendered, RLS-scoped).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Library: TanStack Query v5** (`@tanstack/react-query`) | The standard for exactly this job: caching, background refetch, invalidation, focus-refetch — all built in, small, no server component. SWR would also work; TanStack's invalidation ergonomics are better for our write-heavy flows. |
| D2 | **Server render stays; it seeds the cache (`initialData`)** | First paint is byte-identical to today and still RLS-scoped server-side. The client query takes the server payload as its starting value — no double-fetch on first load. |
| D3 | **Router `staleTimes.dynamic = 300`** (5 min screen snapshots) | Without it, App Router re-blocks on the server for every revisit and the data cache never gets to shine. 5 min bounds how old a *snapshot* can be; the data on it is corrected by Layer 2 within ~1s of mount anyway. |
| D4 | **Cached lists (per-key):** orders list (salesman home / dashboard / godown), products (salesman + dashboard), retailers, deposits (salesman + dashboard) | The hot tabs. Query keys: `["orders", scope]`, `["products", scope]`, `["retailers"]`, `["deposits", scope]`. |
| D5 | **Never cached:** order **detail**, deposit void/edit state, the PDF route, anything inside the approval/billing flow, auth/role | Money decisions read fresh, full stop. Order detail keeps today's always-server behavior. (PDF already sends `Cache-Control: no-store`.) |
| D6 | **Freshness windows (`staleTime`):** orders 15s · deposits 30s · products/retailers 60s; `refetchOnMount: "always"`, `refetchOnWindowFocus: true` | Windows only decide whether a *background* refetch fires — the user always sees the cached paint first. Orders shortest (most volatile, and Realtime narrows it further); catalog/retailers slowest-moving. |
| D7 | **Writes invalidate:** every mutation (submit/edit/cancel order, approve, punch, product save, deposit create/void, retailer edit) calls `invalidateQueries` for its affected keys | The actor sees their own change reflected immediately; other devices converge via windows + Realtime + focus-refetch. Existing `router.refresh()` calls stay in v1 (harmless overlap); pruning them is the later ⑦ cleanup. |
| D8 | **Memory-only cache — no disk persistence** in v1 | Closing the app = clean slate, zero cold-start staleness class. (An offline-tolerant `persistQueryClient` layer is a possible v2, deliberately out of scope.) |
| D9 | **Sign-out does a hard navigation** (`window.location.assign("/login")`) | Flushes both memory layers so nothing cached outlives the session on a shared device. Verify the SignOutButton path during build; add if missing. |
| D10 | **Realtime stays as-is** | OrdersView's live channel keeps pushing row changes into the same rendered list; the query cache and Realtime don't fight — Realtime narrows the staleness window on the one list that matters most. |

## What the user experiences (the 500 → 502 case)

Reopen Products: the cached 500 rows paint instantly → background refetch lands (~0.5s) → header ticks to 502 and the two new rows slot into their sorted positions. Unchanged rows are not re-rendered (React keys by id) — no flicker, no scroll jump unless the new rows land *above* the current viewport (mild, rare shift).

## Interplay with what already exists

- **loading.tsx skeletons** remain — they now cover only first visits/hard loads (revisits skip them entirely).
- **sessionStorage filter persistence** (orders) is orthogonal and untouched — filters restore, data comes from cache.
- **Security invariants:** RLS still scopes every fetch (browser client uses the user's session); RPCs still re-check roles server-side; prices/totals still recomputed server-side at submit. A cache never bypasses any of it — it only remembers what this user was already allowed to see.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Stale flash (seconds-old list shown briefly) | By design; bounded by D6 windows + in-place correction; money screens excluded (D5). |
| Cached screens outliving a session on a shared phone | D9 hard-flush on sign-out; caches are per-tab memory only (D8). |
| Router snapshot shows a 5-min-old *screen* | Only the shell/layout can be that old — the data on it self-corrects on mount (D6 `refetchOnMount:"always"`). |
| Library bloat | ~13kb gzipped, no server piece. |
| Scroll shift when rows insert above viewport | Accepted (rare, mild); revisit only if reported. |

## Out of scope (separate slices)

Slice A (role in session claims), Slice C (service-worker shell caching + update strategy), Slice D (⑭ FK indexes), disk persistence, offline mode, `router.refresh()` pruning (⑦).

## Acceptance (REVIEWER verifies by execution)

1. Flip between two visited tabs: the second visit paints **instantly** (no skeleton), then data corrects in place; measure with throttled network.
2. The 500→502 scenario behaves as described (count ticks, rows slot in, no full reload).
3. Add an order on device A → device B sees it within its window (or instantly via Realtime on orders).
4. Order **detail** still always server-fetches (no cache entry).
5. Sign-out on a cached session → back button cannot show any cached screen.
6. First loads and hard reloads byte-match today's behavior; `tsc`/`eslint`/`build` clean; no DB/RLS diff at all.

## Build plan (suggested commits)

1. `QueryClientProvider` + devtools (dev-only) + `staleTimes` config + sign-out hard-nav.
2. Orders lists onto the cache (initialData + invalidations + Realtime coexistence).
3. Products (both) + retailers + deposits onto the cache.
4. Mutation invalidation sweep + acceptance pass.
