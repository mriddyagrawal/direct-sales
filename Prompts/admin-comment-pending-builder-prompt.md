# Builder prompt — Admin comment on a pending-approval order (red-line note, order stays held)

An admin, on a **`pending_approval`** order, can write a **comment** and submit it. The order
**stays `pending_approval`** (the comment is not an approve/reject). The comment shows **on the
order detail** and as a **red line inside the order's card** on the orders list — visible to
**everyone who can see the order, including the salesman**. Purpose: the admin flags why it's
held / leaves a note to the field ("confirm 5-star stock before I approve").

## Owner decisions (locked)
1. **One overwritable note** per order — editing replaces it (not a thread).
2. **Admin-only** write (matches approval being admin-only).
3. **Visible to everyone incl. the salesman** — it shows on his own order's card + detail.
4. **Order stays `pending_approval`** — commenting never changes status.

## 1. Migration (14-digit `YYYYMMDDHHMMSS`, no `T`; via MCP; reconcile the repo filename)
- **Column:** `alter table public.orders add column admin_comment text;` (nullable — the current
  note). **Distinct from the salesman's existing `orders.notes`** ("notes from the field") — do
  NOT reuse that column.
- **RPC `set_admin_comment(p_order_id uuid, p_comment text)`** (`SECURITY DEFINER`):
  - Reject unless `auth_profile_role() = 'admin'`.
  - Order must be `status = 'pending_approval'` (the comment is a held-stage annotation), else raise.
  - Set `admin_comment = nullif(btrim(p_comment), '')` — so submitting **empty clears** the note.
  - **Status unchanged.** Log a `commented` `order_event` (details `{'comment': …}`) for the audit trail.
  - Return the order.
- **Regenerate** `src/lib/types/database.types.ts`. **No RLS change** — `admin_comment` rides the
  order row, so whoever can SELECT the order (salesman = own, staff = all) sees the note; the
  RPC gates *writes* to admin.

## 2. Wiring + display data
- **`src/lib/order-rpcs.ts`:** `setAdminComment(orderId, comment)` → `set_admin_comment`.
- **`src/components/orders/order-detail-data.ts`:** add `admin_comment` to `ORDER_DETAIL_SELECT`
  and `adminComment` on `OrderDetailData` / `toOrderDetailProps`.
- **`src/components/orders/OrdersView.tsx` `ORDERS_SELECT`:** add `admin_comment` + the field on
  `OrderListRow` (so the card can render the red line).
- **`src/lib/order-events.ts`:** describe `commented` → e.g. "Comment by {name}: {text}" (history).

## 3. `OrderDetailView` — the comment box (admin) + the red note (everyone)
- **Red note (ALL roles), when `adminComment` is present:** a prominent **red** line/box near the
  top (under the hero), clearly labelled so it's not confused with the salesman's field notes —
  e.g. **"Admin note: {adminComment}"** in red. Renders for salesman / staff / anyone viewing.
- **Comment box (admin only** — `isStaff && isAdmin && order.status === 'pending_approval'`**):** a
  textarea pre-filled with the current `adminComment` + a **Submit** button → `setAdminComment(order.id, text)`
  → `router.refresh()`. Submitting empty clears the note. (Reuse the `Button` `loading` +
  `useTransition` pattern for the submit spinner.)
- Order **stays pending** after submit (no status change) — verify the detail still shows the
  Pending-approval chip and the Approve button afterward.

## 4. `OrdersView` — the red line in the card
- When a row has `admin_comment`, render it as a **red line inside the card**, below the
  ref / retailer / amount / meta line — e.g. a small red row `⚠ {admin_comment}` (truncate long
  text to a line or two). For **every** role (the salesman sees it on his own orders).
- Primary surface is the mobile **card**; if easy, the desktop table row shows it as a red
  sub-line too. Don't let it break the card layout / cause overflow.

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Admin-only write:** an admin sets a comment on a pending order → `admin_comment` stored,
  status still `pending_approval`, a `commented` event logged (prove live). A non-admin
  (accountant **or** salesman) calling `set_admin_comment` is **rejected**; commenting a
  non-`pending_approval` order is rejected.
- **Overwritable + clear:** re-submitting replaces the note; submitting empty **clears** it (red
  line disappears).
- **Visibility:** the salesman sees the red line on his **own** pending order's card + the red
  note on its detail, and **cannot** set it (no box, RPC denies).
- **Card + detail render** the red line/note; order stays pending; **Approve still works** after
  a comment.
- `npm run build` + `tsc` + eslint clean; types regenerated; migration filename reconciled.

## Guardrails
- **Admin-only** write; commenting **never** changes status; `pending_approval` orders only.
- **Distinct column** — do NOT overload the salesman's `orders.notes`.
- The red note is **read-only** for non-admin and **visible to everyone** who can see the order
  (no RLS change — the RPC gates writes; the column rides the already-RLS'd order row).
- Money / pricing / the state machine untouched — this is one column + one admin RPC + display.
