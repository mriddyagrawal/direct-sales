# Client data cache — "instant tabs" (Phase 6 · Slice B)

**Status:** v3 — builder review rounds 1–2 + owner discussion folded in, 2026-07-24 · **Author:** REVIEWER, with the owner
**Parent plan:** [future-plans.md §App feel & performance](../future-plans.md) / PLAN.md Phase 6 item ② ("cache everything except the data" — owner 2026-07-11)
**Ground rule:** FE-only. No DB change, no RLS change, no new server privileges. The server stays the only source of truth.

## Problem

Every tab tap re-runs the full server pipeline (auth round-trip + role query + the page's DB queries) before anything paints. Skeletons (Phase 6 ①) made the wait *visible*; nothing yet made it *short*. A revisited tab knows nothing from the last visit.

## Approach — two memory layers, network stays the truth

**Layer 1 — screen snapshot (Next.js router cache).** Configure `staleTimes` so a *client-side* revisit to a recently seen page repaints the **last rendered screen instantly** instead of waiting for the server. In-memory, per-tab, gone on hard reload. **Caveat (BUILDER):** this is `experimental.staleTimes` — build-plan step 0 is confirming the flag's name + semantics on our exact Next version *by experiment*; if it's unavailable or misbehaves, **Layer 2 ships alone** (still the bigger win) and Layer 1 waits.

**Layer 2 — data cache (TanStack Query v5).** The hot lists move their data into client queries seeded by the server render. On every mount the cached list paints **immediately** and a background refetch fires; fresh results are applied **in place** (rows appear/change/vanish; counts tick — no reload, no flash). This is the classic *stale-while-revalidate* pattern.

Layer 1 makes the page appear instantly; Layer 2 makes the data on it correct itself within ~a second. First visits and hard reloads behave exactly as today (server-rendered, RLS-scoped).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Library: TanStack Query v5** (`@tanstack/react-query`) | The standard for exactly this job: caching, background refetch, invalidation, focus-refetch — all built in, small, no server component. SWR would also work; TanStack's invalidation ergonomics are better for our write-heavy flows. |
| D2 | **Server render stays; it seeds the cache** — `initialData` **plus `initialDataUpdatedAt`** (the server fetch's timestamp, client-capped `Math.min(ts, Date.now())` against clock skew) | First paint is byte-identical to today and still RLS-scoped server-side. The timestamp lets TanStack know the seed is *fresh*, so the first mount does **not** re-fetch — no cold-load double-fetch (BUILDER catch: `refetchOnMount:"always"` would have re-hit the DB on every first load; see D6). |
| D3 | **Router `staleTimes.dynamic = 300`** (5 min screen snapshots) — **paired with D11**, because this knob is global and cannot exclude routes | Without it, App Router re-blocks on the server for every revisit. The snapshot's *data* self-corrects via Layer 2 on the D4 lists — but D5 pages have no Layer 2, so alone this would show a 5-min-old approval screen (BUILDER blocking issue #1 = the same hole the owner found in discussion). D11 closes it. |
| D4 | **Cached lists (per-key):** orders list (salesman home / dashboard / godown), products (salesman + dashboard), retailers, deposits (salesman + dashboard), **and the Quick Order catalog + retailer picker** (owner add) | The hot tabs + the order-entry picker. Keys: `["orders", scope]`, `["products", scope]`, `["retailers"]`, `["deposits", scope]`, `["catalog"]`. The catalog is safe to cache: `submit_order` re-prices fixed brands server-side, so a stale picker price cannot produce a wrong order. **Standing assumption (write it in code comments too):** these coarse keys are only correct because every list is a *bounded fetch-all with client-side filtering* (orders `.limit(300)`, deposits `.limit(500/1000)`, products/retailers/catalog uncapped-under-row-cap — builder-verified). If any list ever moves to server-side filtering/pagination, its key MUST grow the filter params. |
| D5 | **Never cached:** order **detail**, deposit void/edit state, the PDF route, anything inside the approval/billing flow, auth/role | Money decisions read fresh, full stop. Order detail keeps today's always-server behavior. (PDF already sends `Cache-Control: no-store`.) |
| D6 | **`staleTime` ≈ 5–10s on every cached list** (a rapid-flip dedupe, not a freshness budget) + `refetchOnMount: true` (default, stale-triggered) + `refetchOnWindowFocus: true` | Owner call: *every* visit should re-ask the server — the page just never waits for the answer. With D2's `initialDataUpdatedAt`, the first mount reads as fresh (no duplicate); any revisit older than ~5–10s refetches immediately in the background. The old 15/30/60s tiers are dropped. |
| D7 | **Writes invalidate:** every mutation (submit/edit/cancel order, approve, punch, product save, deposit create/void, retailer edit) calls `invalidateQueries` for its affected keys | The actor sees their own change reflected immediately; other devices converge via windows + Realtime + focus-refetch. Existing `router.refresh()` calls stay in v1 (harmless overlap); pruning them is the later ⑦ cleanup. |
| D8 | **Memory-only cache — no disk persistence** in v1 | Closing the app = clean slate, zero cold-start staleness class. (An offline-tolerant `persistQueryClient` layer is a possible v2, deliberately out of scope.) |
| D9 | **Any transition to signed-out wipes everything** — `onAuthStateChange(SIGNED_OUT)` → `queryClient.clear()` + hard navigation (`await signOut()` **then** `location.assign("/login")` — that order), **plus a `pageshow` handler that reloads when `event.persisted`** | Owner call: auto sign-outs must wipe like the button. Builder-verified: today's SignOutButton is a *soft* `router.push` — the hard-nav is genuinely missing, add it. The `pageshow` buster covers **iOS/WebKit back-forward cache**, which can restore the previous page from memory with zero network after a hard nav (`no-store` does not reliably prevent it on iOS — and this is a phone PWA). |
| D10 | **Realtime writes into the query cache — ONE source of truth** (this is the core of build commit 2, not a footnote). The migrated OrdersView renders **only** from `useQuery`; the Realtime handlers' row-refetches land via `queryClient.setQueryData(["orders", scope], …)`; the `useState(initialOrders)` + render-phase re-seed from `05c3bd0` are **superseded and removed** in the same commit. **Convergence rule:** if a background refetch is in flight when a Realtime event lands, the key is invalidated again once that fetch settles — so a response snapshotted at T0 landing at T2 can never permanently erase an event from T1. The `visibilitychange`/`online` net becomes `invalidateQueries(["orders"])` (cheaper than a full `router.refresh()`). | Pre-slice fixes stand (`eba5311` setAuth-before-subscribe + refresh-token follow; status-aware subscribe with retry). Two writers into two stores = rows flickering back to dead states ~1s after every visit; one cache, one convergence rule kills the whole class. Nothing may *depend* on the socket. |
| D11 | **`<RefreshIfStale renderedAt={…} />` on every D5 page** — a tiny client component: on mount, if `Date.now() − renderedAt > ~10s`, call `router.refresh()` once | Closes the D3×D5 hole (BUILDER #1): a router-snapshot money screen paints instantly, then re-renders fresh in ~1s — same philosophy as the lists (paint fast, correct fast), applied to the pages the query cache deliberately skips. The ~10s age guard means genuinely fresh first visits don't double-render; generous enough to absorb phone clock skew. |
| D12 | **Shared query builders — the list query exists ONCE** (BUILDER #3): each D4 list gets one builder in `src/lib/queries/` parameterized by the Supabase client (`fetchOrdersList(supabase, scope)` …), imported by BOTH the server page and the browser `queryFn`. Same embeds, same sort, same caps, by construction. | Duplicated query logic drifts, and drift here means rows flash/vanish/reorder ~1s after every visit, forever. Related **per-list verification task (not an assumption):** every admin/godown/salesman list query must be proven to return identical rows under the *browser* client's RLS as under the server client — acceptance #10. |
| D13 | **A failed background refetch never blanks a painted list** — components render from data presence (`data` exists → render it), never gate on `isError`; errors surface as a quiet retry affordance at most. | Salesman networks are flaky; a refetch failure after a successful paint must degrade to "slightly stale," not to an empty screen. |

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
| Router snapshot shows a 5-min-old *screen* | D4 lists self-correct via Layer 2 on mount; **D5 money pages self-correct via D11's mount refresh (≤ ~1.5s)**. |
| Library bloat | ~13kb gzipped, no server piece. |
| Scroll shift when rows insert above viewport | Accepted (rare, mild); revisit only if reported. |
| Phone clock skew vs freshness math | `initialDataUpdatedAt` client-capped at `Date.now()`; D11 threshold generous (~10s). |

## Out of scope (separate slices)

Slice A (role in session claims), Slice C (service-worker shell caching + update strategy), Slice D (⑭ FK indexes), disk persistence, offline mode, `router.refresh()` pruning (⑦).

## Acceptance (REVIEWER verifies by execution)

1. Flip between two visited tabs: the second visit paints **instantly** (no skeleton), then data corrects in place; measure with throttled network.
2. The 500→502 scenario behaves as described (count ticks, rows slot in, no full reload).
3. Add an order on device A → device B sees it within its window (or instantly via Realtime on orders).
4. Order **detail** still always server-fetches (no cache entry).
5. Sign-out on a cached session → back button cannot show any cached screen — **verified on Chrome AND iOS Safari** (the `pageshow`/`persisted` buster is what makes Safari pass; without it WebKit's bfcache restores pages from memory with zero network).
6. First loads and hard reloads byte-match today's behavior; `tsc`/`eslint`/`build` clean; no DB/RLS diff at all.
7. **Cold load fires exactly ONE data fetch per list** (server seed only — no client duplicate; verify in the network tab).
8. **A D5 money page revisited within the snapshot window shows the fresh server state ≤ ~1.5s** (D11) — e.g. open a pending order, back out, change its status elsewhere, reopen: the stale snapshot corrects itself without user action.
9. Auto sign-out (expired session) wipes caches exactly like the button (D9).
10. **Per role (salesman / admin / godown / accountant), the browser-client refetch of every D4 list deep-equals the server payload** (same rows, same order — proves D12's shared builders + RLS parity by execution).
11. Realtime event during an in-flight refetch converges to server truth (D10's rule) — no row flickers back to a dead state.
12. Kill the network after a successful paint → the list stays painted (D13), no blank screen.

## Build plan (suggested commits)

0. **Spike: prove `experimental.staleTimes` on our exact Next version** (name, semantics, revisit behavior). If it fails → Layer 2 alone, Layer 1 deferred.
1. `QueryClientProvider` + devtools (dev-only) + `staleTimes` config + D9 (auth-state wipe, signOut→assign order, `pageshow` buster) + `<RefreshIfStale>` on the D5 pages + `src/lib/queries/` shared builders (D12).
2. **Orders lists onto the cache — the hard commit (D10):** render from `useQuery` only; Realtime handlers write via `setQueryData`; the `useState`+re-seed from `05c3bd0` removed; convergence rule + visibility/online → `invalidateQueries`.
3. Products (both) + retailers + deposits + the Quick Order catalog onto the cache (all through D12 builders).
4. Mutation invalidation sweep + full acceptance pass (one-fetch cold-load, D11, deep-equal-per-role #10, convergence #11, offline-paint #12).
