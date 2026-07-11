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
- **`order-status.ts`** (`getOrderStatusTag`) + **`StatusTag`** + CSS: add a `dispatched` tone
  (distinct from billed's green — e.g. indigo/teal, `--color-dispatched`), label **"Dispatched"**.
- **`order-events.ts`**: `dispatched` → "Dispatched by {name}".
- **`order-rpcs.ts`**: `dispatchOrder(orderId)` → `dispatch_order`.
- **`order-detail-data.ts`**: add `dispatched_at`, `dispatched_by`,
  `dispatched_by_profile:profiles!orders_dispatched_by_fkey(full_name)` to `ORDER_DETAIL_SELECT`;
  `dispatchedAt`/`dispatchedByName` on `OrderDetailData`.

## 3. `OrderDetailView` — add the `godown` role + Mark dispatched (ONE component, every role)
Widen the role union → **`"salesman" | "staff" | "godown"`**.
- **Mark dispatched** action: shows when `status==='billed'` for **`role==='godown' || isStaff`**
  (godown, accountant, admin) — a `truck`-glyph primary via a light confirm (no input). **Never**
  the salesman. The SAME action serves the dashboard detail (`/dashboard/orders/[id]`, accountant/
  admin) AND the godown detail (`/godown/orders/[id]`).
- **`dispatched` view:** terminal — Share (staff) + Cancel (accountant/admin); byline gains
  `· dispatched {time} by {name}`.
- **Godown lens** (`role==='godown'`): **read-only** — NO Approve / Edit / Mark-billed / Cancel /
  Punch. DOES render items, **serials**, HISTORY, retailer, and **prices**. The godown's only
  action is **Mark dispatched** on a billed order.
- **⚠️ MANDATORY audit — the reuse gotcha:** the salesman guidance banners today render on
  `{!isStaff}`, which is **also true for `godown`** — so the godown would wrongly inherit the
  salesman's "Waiting for approval…" notes. **Change every `!isStaff` that means "salesman" to an
  explicit `role === 'salesman'`.** Grep the whole file for `!isStaff` and fix each.
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
- **`OrdersView` `role="godown"` customization:** per-route title ("Dispatch" / "History"); **no
  Salesman/Brand filters** (keep search + date range); **hide the status chip-tabs** (the bottom
  bar IS the status nav); `detailBase='/godown/orders'`; keep Realtime + search; **prices shown**.
  Add a `statusScope?: string[]` prop (or per-route filter) so each route locks its status set.
- **`/godown/orders/[id]`** (NEW route) — renders the reused `OrderDetailView` with `role="godown"`
  (distinct from `/godown/[id]`, the scanner).

## Commit sequence (atomic)
1. Migration (cols, both CHECKs, guard edges, `dispatch_order`, `cancel_order`, godown RLS widen
   incl. **`order_events_select_godown`**) + types.
2. Shared vocab (tone/label, event, `dispatchOrder`, detail-data).
3. `OrderDetailView`: add the `godown` role + Mark dispatched (godown/staff on billed) + the
   **`!isStaff` → `role==='salesman'` audit** + the dispatched terminal view + byline.
4. Dashboard `OrdersView`: Dispatched tab.
5. `OrdersView` `role="godown"` + `statusScope` (hide chip-tabs + salesman/brand filters, godown
   detailBase, prices shown); `GodownTabBar`; the `/godown/dispatch`, `/godown/history`,
   `/godown/orders/[id]` routes; Pickup gets the bar (scanner doesn't).
6. Docs: `order-lifecycle.md`, `godown-fulfilment-design.md`, `orders-ui.md` (dispatched chip +
   tab + Mark dispatched + `truck`; the godown-reuses-OrdersView/OrderDetailView note).

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Dispatch role-gated:** godown, accountant, admin each move a `billed` order → `dispatched`
  (prove all three); the **salesman cannot** (no button + `dispatch_order` raises). Non-`billed`
  can't be dispatched. **All brands** (a Zebronics billed order dispatches). Return path
  (`dispatched → cancelled`, accountant/admin). Bill-no invariant holds for `dispatched`.
- **Reuse renders correctly:** the godown's `/godown/orders/[id]` (reused `OrderDetailView`) shows
  items + serials + **HISTORY** (proves `order_events_select_godown`) + prices, with **Mark
  dispatched** on a billed order and **NO salesman guidance banners** (proves the `!isStaff`
  audit). Dispatch/History (reused `OrdersView`) list the right status-scoped orders, no
  salesman/brand filters, no status chip-tabs, rows open the godown detail.
- **Bespoke intact:** Pickup queue + the scanner unchanged; tab bar hidden on the scanner.
- **Dashboard:** Dispatched tab + counts; accountant/admin Mark dispatched from the dashboard
  detail; "Dispatched by {name}" in history.
- `npm run build` + `tsc` + eslint clean; types regenerated; migration reconciled.

## Guardrails
- **Reuse** `OrdersView`/`OrderDetailView` (add `godown` as a role) — do NOT fork new list/detail
  components. Bespoke ONLY: the Pickup pick-contents card + the scanner `PickScreen`.
- **The `!isStaff` → `role==='salesman'` audit is mandatory** — or the godown inherits salesman UI.
- `dispatched` only from `billed`, only godown/accountant/admin; the salesman never dispatches.
- Additive backend only (one status, two columns, one RPC, guard edges, additive RLS incl.
  `order_events`); don't touch approval / billing / the scan-pick flow / money math.
- Keep the `billed`/`dispatched` bill-no invariant.
- The bespoke pick screen stays **price-free**; the reused godown surfaces MAY show prices (owner OK).
