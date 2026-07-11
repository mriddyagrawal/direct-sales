# Builder prompt — STAGE 2: Dispatch status + godown app (REUSING the shared Orders components)

> **Do [Stage 1 — fulfilment overhaul](fulfilment-overhaul-stage1-builder-prompt.md) first** (shipped/merged).
> Stage 1 already makes the godown handle **all brands** through `approved` (brand-aware +
> partial pick), widened godown RLS to all-brand `approved`/`ready_to_bill`, and added the
> `backorder` status. Stage 2 adds the **`dispatched`** status + the godown's **Dispatch**
> and **History** tabs — and builds those two tabs by **REUSING the shared `OrdersView` +
> `OrderDetailView` with a new `godown` role**, not bespoke godown list/detail screens.

A lifecycle stage after billing: a **billed** order is marked **dispatched** when it
physically ships. All brands. Done by **godown / accountant / admin** — never the salesman.
This prompt **supersedes + folds in** the old `godown-history-tabs`. Context:
[order-lifecycle.md](../docs/specs/order-lifecycle.md),
[godown-fulfilment-design.md](../docs/godown-fulfilment-design.md),
[orders-ui.md](../docs/specs/orders-ui.md).

## Owner decisions
1. Godown app = **Pickup · Dispatch · History** (a real Dispatch tab).
2. `dispatched → cancelled` stays (accountant/admin — the returns path).
3. **Prices:** the godown MAY see prices (owner: "don't go the extra mile hiding them").
   Since we're **reusing** the shared order components, showing amounts is the *simpler*
   path — so the reused Dispatch/History lists + the godown detail render prices like every
   other role. Only the **bespoke pick screen stays price-free** (it already selects no price
   columns — leave it that way).
4. **Reuse, don't duplicate:** `godown` becomes a first-class **`role`** on `OrdersView` +
   `OrderDetailView` (alongside `salesman`/`staff`). Hand-built code stays **only** where the
   job is genuinely different: the **Pickup queue card** (shows pick-contents) and the
   **scanner `PickScreen`**.

## The new machine (additions only — everything else unchanged)
```
… → billed ──dispatch (godown / accountant / admin)──▶ dispatched
   dispatched ──cancel (reason; accountant / admin)──▶ cancelled
```
`dispatched` is otherwise terminal.

## 1. Migration (14-digit `YYYYMMDDHHMMSS`, no `T`; via MCP; reconcile the repo filename)
- **Columns:** `alter table orders add column dispatched_at timestamptz, add column dispatched_by uuid references public.profiles(id);` (mirror `processed_by`; note the FK name `orders_dispatched_by_fkey` for the detail embed).
- **Status CHECK** (`orders_status_check`): add `'dispatched'` →
  `('backorder','pending_approval','approved','ready_to_bill','billed','dispatched','cancelled')`.
- **Bill-no CHECK** (`orders_billed_requires_bill_no`): extend to `dispatched` (it was billed) →
  `CHECK (status NOT IN ('billed','dispatched') OR (tally_bill_no IS NOT NULL AND btrim(tally_bill_no) <> ''))`.
- **`guard_order_transition`** — add, keep all existing:
  - `old='billed' AND new='dispatched'`: allow only if `auth_profile_role() IN ('godown','accountant','admin')`, else raise; `return new`.
  - `old='dispatched' AND new='cancelled'`: `return new` (role enforced in `cancel_order`).
- **`dispatch_order(p_order_id uuid)`** — new `SECURITY DEFINER` RPC (model on `process_order`):
  reject unless role ∈ (godown, accountant, admin); `FOR UPDATE`; require `status='billed'`;
  set `status='dispatched', dispatched_at=now(), dispatched_by=v_caller`; log a `dispatched`
  event; return the row.
- **`cancel_order`** — permit cancelling a `dispatched` order (mirror `billed`).
- **Godown RLS widening** — the godown SELECT policies (`orders_select_godown`,
  `order_items_select_godown`, `order_item_scans_select_godown`) currently allow all-brand
  `approved`/`ready_to_bill` (Stage 1). Widen to also allow **`billed`/`dispatched`/`cancelled`**
  (all brands) for the Dispatch + History views. Additive SELECT only.
- **NEW for the reuse:** the godown will open the shared `OrderDetailView`, whose query embeds
  **`order_events`** (the HISTORY panel). Add an **`order_events_select_godown`** SELECT policy
  (godown may read events whose order it can already see) — **without it the reused detail's
  history is blank**. Verify godown can also read the embedded `retailers`/`products`/`profiles`
  (existing policies cover these) so the reused detail fully renders.
- **Regenerate** `src/lib/types/database.types.ts`.

## 2. Shared status vocabulary
- **Status tone — the tone lives in THREE places, add all three** (grep how `backorder` was
  added as a template): (a) `getOrderStatusTag` in `order-status.ts` — one `if (order.status ===
  'dispatched') return { tone: 'dispatched', label: 'Dispatched' };` line; (b) the `StatusTone`
  union in `StatusTag.tsx` — add `"dispatched"`; (c) a `.dispatched` block in
  `StatusTag.module.css` + a `--color-dispatched` token in `globals.css` (distinct from billed's
  green — e.g. indigo/teal). Missing any one = an unstyled/black chip.
- **`order-events.ts`**: `dispatched` → "Dispatched by {name}".
- **`order-rpcs.ts`**: `dispatchOrder(orderId)` → `dispatch_order`.
- **`order-detail-data.ts`**: add `dispatched_at`, `dispatched_by`,
  `dispatched_by_profile:profiles!orders_dispatched_by_fkey(full_name)` to `ORDER_DETAIL_SELECT`;
  `dispatchedAt`/`dispatchedByName` on `OrderDetailData`.

## 3. `OrderDetailView` — add the `godown` role + Mark dispatched (ONE component, every role)
Widen the role union → **`"salesman" | "staff" | "godown"`**.
- **Mark dispatched** action: shows when `status==='billed'` for **`role==='godown' || isStaff`**
  (godown, accountant, admin) — a `truck`-glyph **primary** via a light confirm (reuse `BottomSheet`
  with a confirm button, **no input** — like the "PAKKA?" short-pick sheet; NOT the Mark-billed
  sheet, which has a bill-no field). **Never** the salesman. The SAME action serves the dashboard
  detail (`/dashboard/orders/[id]`, accountant/admin) AND the godown detail (`/godown/orders/[id]`).
  - **⚠️ One filled-accent per view:** today a `billed` order's PRIMARY is the Share PDF button
    (`variant="primary"`). On a **dispatchable** billed order, Mark dispatched becomes the primary,
    so **demote the billed Share-PDF to the ink secondary** (it already renders as an `ink`
    secondary for non-billed/cancelled statuses — extend that path to billed-when-dispatchable) —
    else there are two filled buttons.
- **`dispatched` view:** terminal — Share (staff) + Cancel (accountant/admin); byline gains
  `· dispatched {time} by {name}`.
- **Godown lens** (`role==='godown'`): **read-only** — NO Approve / Edit / Mark-billed / Cancel /
  Punch. DOES render items, **serials**, HISTORY, retailer, and **prices**. The godown's only
  action is **Mark dispatched** on a billed order.
- **⚠️ MANDATORY reuse audit — grep `isStaff` AND `!isStaff`; it cuts BOTH ways.** `isStaff = role
  === "staff"`, so `godown` is `!isStaff` and inherits the salesman branch of every binary. Fix
  each of these (verified line refs, 2026-07-12):
  1. **Salesman-only UI must EXCLUDE godown** (`!isStaff` → `role === 'salesman'`): the guidance
     banners block (`{!isStaff && …}` "Waiting for office approval…", ~L626); the salesman Edit →
     `/new-order?edit` (~L564); the `!isStaff && status==='approved'` salesman block (~L579);
     `salesmanActionable` (~L147). Grep every `!isStaff` and decide salesman-vs-godown per site.
  2. **Staff-only content the godown MUST see must INCLUDE godown** (`isStaff` → `isStaff || role
     === 'godown'`): **serial rendering is `isStaff`-gated** (`serialsPending` ~L255 and the serial
     sub-rows `{isStaff && showSerialRows && …}` ~L653) — leave it as-is and the godown sees **no
     serials**, contradicting this section. Widen those to include godown.
  3. **Routing bases are BINARY and must become role-aware (3-way)** — this is NOT a "salesman
     banner", it's navigation, and getting it wrong sends the godown to `/orders`, which it is
     **fenced out of** (redirect/broken nav): `detailBase = isStaff ? '/dashboard/orders' :
     '/orders'` (~L210) and the parent-link (~L534) + backorder-child link (~L614). Make all of
     them resolve `role==='godown'` → `/godown/orders`. (A small `orderBaseFor(role)` helper beats
     three inline ternaries.)
- Salesman `billed`/`dispatched`: unchanged read-only notes.

## 4. Dashboard list (`OrdersView`) — Dispatched tab
Add `dispatched` to `StatusFilter`, `STATUS_LABEL` ("Dispatched"), `tabCounts`, and the tab array
**after Billed**. (Shared component, so the salesman's list gets the tab too — read-only.)

## 5. Godown app — 3 tabs; Dispatch/History REUSE `OrdersView`
`GodownTabBar` (mirror the glyph-based `src/components/BottomTabBar.tsx`): **Pickup** (`/godown`,
`scan-barcode`) · **Dispatch** (`/godown/dispatch`, `truck`) · **History** (`/godown/history`,
`history`). Active by `usePathname`; on the three list pages; **hidden on the scanner**
(`/godown/[id]`); bottom padding.
- **Pickup** (`/godown`) — **bespoke, unchanged:** the existing all-brand approved queue with
  its pick-contents cards → the scanner `PickScreen` (`/godown/[id]`). Just add the tab bar. Stays
  **price-free**.
- **Dispatch** (`/godown/dispatch`, NEW) — **reuse `OrdersView`** with `role="godown"`, status
  scope `['billed']`. Rows → `/godown/orders/[id]` (the reused detail, where Mark dispatched lives).
- **History** (`/godown/history`, NEW) — **reuse `OrdersView`** with `role="godown"`, status scope
  `['ready_to_bill','dispatched','cancelled']`. Read-only browse.
- **`OrdersView` `role="godown"` customization** (verified line refs, 2026-07-12):
  - **`detailBase`** is binary today — `isStaff ? '/dashboard/orders' : '/orders'` (~L78). Make it
    3-way so `role==='godown'` → `/godown/orders` (same helper as OrderDetailView; a godown row must
    open the godown detail, not `/orders`).
  - **Title** is binary — `isStaff ? 'Orders' : 'My orders'` (~L234); there's no hook for a godown
    title. Add a `title?: string` prop (or role-based) so the routes render **"Dispatch" / "History"**.
  - **Salesman/Brand filters are ALREADY `{isStaff && …}`** (~L255) → hidden for godown for free
    (reuse win — don't re-gate). Keep search + date range. **Prices shown** (godown OK).
  - **Hide the status chip-tabs** for godown (the bottom bar IS the status nav) and add a
    **`statusScope?: string[]`** prop that filters at the `scoped` stage (~L174) so each route locks
    its set (Dispatch `['billed']`, History `['ready_to_bill','dispatched','cancelled']`). With
    tabs hidden the `status` state stays `"all"`, so `finalFiltered` = the scoped set.
  - Audit the salesman-only `!isStaff` bits here too: the D8 self-cancel hide
    (`!isStaff && cancelled_by===currentUserId` ~L102) and the salesman empty-state (~L279) —
    harmless for godown (never a cancel actor / owner) but tidy to `role==='salesman'`.
- **`/godown/orders/[id]`** (NEW route) — renders the reused `OrderDetailView` with `role="godown"`
  (distinct from `/godown/[id]`, the scanner).

## Commit sequence (atomic)
1. Migration (cols, both CHECKs, guard edges, `dispatch_order`, `cancel_order`, godown RLS widen
   incl. **`order_events_select_godown`**) + types.
2. Shared vocab (tone/label, event, `dispatchOrder`, detail-data).
3. `OrderDetailView`: add the `godown` role + Mark dispatched (godown/staff on billed, Share
   demoted so one primary) + the **two-way `isStaff` audit** (salesman-only `!isStaff` →
   `role==='salesman'`; serial rendering `isStaff` → `isStaff||godown`; **3-way routing bases** so
   godown links stay in `/godown/orders`) + the dispatched terminal view + byline.
4. Dashboard `OrdersView`: Dispatched tab (after Billed).
5. `OrdersView` `role="godown"` + `statusScope` + `title` prop (hide chip-tabs, 3-way detailBase,
   filters already isStaff-gated, prices shown); `GodownTabBar`; the `/godown/dispatch`,
   `/godown/history`, `/godown/orders/[id]` routes; Pickup gets the bar (scanner doesn't).
6. Docs: `order-lifecycle.md`, `godown-fulfilment-design.md`, `orders-ui.md` (dispatched chip +
   tab + Mark dispatched + `truck`; the godown-reuses-OrdersView/OrderDetailView note).

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Dispatch role-gated:** godown, accountant, admin each move a `billed` order → `dispatched`
  (prove all three); the **salesman cannot** (no button + `dispatch_order` raises). Non-`billed`
  can't be dispatched. **All brands** (a Zebronics billed order dispatches). Return path
  (`dispatched → cancelled`, accountant/admin). Bill-no invariant holds for `dispatched`.
- **Reuse renders correctly:** the godown's `/godown/orders/[id]` (reused `OrderDetailView`) shows
  items + **serials** (proves the `isStaff → isStaff||godown` widening — a bare reuse would hide
  them) + **HISTORY** (proves `order_events_select_godown`) + prices, with **Mark dispatched** on a
  billed order and **NO salesman guidance banners** (proves the `!isStaff` audit). Dispatch/History
  (reused `OrdersView`) list the right status-scoped orders, titled "Dispatch"/"History", no
  salesman/brand filters, no status chip-tabs, rows open the godown detail.
- **Navigation stays inside `/godown`** (proves the 3-way routing fix): from the godown detail,
  every link — the row taps, the byline breadcrumb, and any parent/backorder link — resolves to
  `/godown/orders/…`, **never `/orders`** (which godown is fenced out of → a redirect would prove
  the bug). A billed godown/dashboard detail shows exactly **ONE filled primary** (Mark dispatched;
  Share is the ink secondary).
- **Bespoke intact:** Pickup queue + the scanner unchanged; tab bar hidden on the scanner.
- **Dashboard:** Dispatched tab + counts; accountant/admin Mark dispatched from the dashboard
  detail; "Dispatched by {name}" in history.
- `npm run build` + `tsc` + eslint clean; types regenerated; migration reconciled.

## Guardrails
- **Reuse** `OrdersView`/`OrderDetailView` (add `godown` as a role) — do NOT fork new list/detail
  components. Bespoke ONLY: the Pickup pick-contents card + the scanner `PickScreen`.
- **Route protection is already automatic — do NOT touch `src/proxy.ts` / `lib/supabase/middleware.ts`.**
  `updateSession` fences on `pathname.startsWith('/godown/')`, so `/godown/dispatch|history|orders/[id]`
  are godown-gated for free (salesman + staff fenced OUT of `/godown` → staff dispatch from
  `/dashboard/orders/[id]`, godown from `/godown/orders/[id]`). No new route entries needed.
- **The two-way `isStaff` audit is mandatory** (§3): `!isStaff`-means-salesman → `role==='salesman'`
  (exclude godown from salesman UI) AND `isStaff`-gated serials → `isStaff||godown` (include godown);
  plus the 3-way routing bases — or the godown gets salesman banners, no serials, and broken nav.
- `dispatched` only from `billed`, only godown/accountant/admin; the salesman never dispatches.
- Additive backend only (one status, two columns, one RPC, guard edges, additive RLS incl.
  `order_events`); don't touch approval / billing / the scan-pick flow / money math.
- Keep the `billed`/`dispatched` bill-no invariant.
- The bespoke pick screen stays **price-free**; the reused godown surfaces MAY show prices (owner OK).
