# Builder prompt — Admin full-edit via the reused QuickOrder flow (retailer + items + prices + reason)

Replace the clunky admin/accountant **inline** order editor (in `OrderDetailView`, `mode="edit"`) with the
salesman's **QuickOrder** flow — the good one — and extend it so the **ADMIN** can additionally change the
**retailer** and **per-line prices** (any brand, incl. fixed), at **any stage** the admin may edit, with an
**edit reason** captured for post-approval edits. **One editor, reused, role-gated** — not a second one.

Context: [order-lifecycle.md](../docs/specs/order-lifecycle.md), [roles-and-permissions.md](../docs/specs/roles-and-permissions.md),
the cancel/edit matrices (already shipped), and the manual-default-price + P5b work (`f7c93ef`).

## Owner decisions (locked)
1. **Reuse QuickOrder.** The admin/accountant **Edit** navigates to `/new-order?edit=<id>` (like the salesman
   already does — the flow role-routes), **not** the inline editor. Retire the `OrderDetailView` inline edit mode.
2. **Admin can edit:** the **retailer** (new — not editable today), **items/qty** (already possible), and
   **prices** — for **every brand incl. fixed** (a deliberate, **admin-only** exception to the untamperable rule).
3. **"Everywhere" = any stage the admin can already edit** — the cancel/edit matrix is UNCHANGED (admin: any
   non-cancelled order; accountant & salesman: `pending_approval` only). This feature changes the *editor* and
   *what admin can edit*, not *who* may edit or *which* stages.
4. **Edit reason** — **owner decision (locked 2026-07-16): required for a POST-APPROVAL admin edit ONLY**
   (`edited_after_lock`), captured via a **BottomSheet on Confirm** (the same mechanic as the Mark-billed "Tally
   bill number" sheet). A `pending_approval` edit (salesman, accountant, or admin) needs **no** reason — don't add
   friction to a normal pending edit. Keep the gate as a single condition (`admin && status ≠ 'pending_approval'`)
   so an "always-for-admin" flip later is a one-liner, but ship it post-approval-only.
5. **Tally desync** on editing a billed/dispatched order is **accepted** — not a concern here.

## 1. Migration — `update_order_items` (14-digit `YYYYMMDDHHMMSS`, no `T`; via MCP; reconcile the repo filename)
Recreate `update_order_items` — keep the current body (role/stage edit gate, brand guard, before/after audit,
delete-removed, the P5b existing-snapshot fallback) and make exactly these changes:

- **New param `p_retailer_id uuid DEFAULT NULL`** (append; keep `p_reason` last-but-one or adjust the signature +
  regen types). When it's non-null **AND** `v_role = 'admin'`: verify the retailer exists (`raise` if not) and
  `update public.orders set retailer_id = p_retailer_id where id = p_order_id`. A **non-admin** supplying it →
  **ignore** it (never change the retailer for salesman/accountant). Include the retailer change in the
  `edited_after_lock`/`items_changed` event details (e.g. `retailer_changed: true`).
- **Admin all-brand price override** — replace the per-line price computation (both branches) with one rule:
  ```
  v_may_price := (v_pricing_mode = 'manual') OR (v_role = 'admin');
  v_unit_price := coalesce(
    case when v_may_price then (v_item->>'unit_price_paise')::int else null end,  -- honored client price
    (select unit_price_paise from public.order_items                              -- existing snapshot (P5b)
       where order_id = p_order_id and product_id = v_product_id),
    v_product.price_paise                                                          -- new line: catalog / default
  );
  if v_unit_price is null or v_unit_price <= 0 or v_unit_price > c_price_ceiling then raise …; end if;
  ```
  So: **manual** brands honor a client price as today; **fixed** brands honor a client price **only when the caller
  is admin** — salesman/accountant fixed prices stay **ignored** (untamperable holds). The existing-snapshot
  fallback means an untouched line keeps its price. Use `v_unit_price` for **both** the existing-line update and the
  new-line insert, **both** brand branches.
- **`p_reason` unchanged** — still required when an admin edits past `pending_approval` (`edited_after_lock`).
- Regenerate `src/lib/types/database.types.ts`.

## 2. Wiring — `src/lib/order-rpcs.ts`
- `updateOrderItems(orderId, notes, items, reason?, prices?, retailerId?)` → pass `p_retailer_id` + `p_reason` +
  the `prices` map (already supported by `toItemsPayload`). Keep the fixed/manual payload rule (`toItemsPayload`
  sends `unit_price_paise` only when a price is set — now the admin's price fields will set it).

## 3. Route the admin/accountant Edit to QuickOrder (retire the inline editor)
- **`OrderDetailView`:** the **Edit** button (currently `isStaff && setMode('edit')`) → **navigate** to
  `/new-order?edit=${order.id}` for **staff** too (admin: any non-cancelled/non-dispatched per the current button
  gate; accountant: `pending_approval` only — keep the existing gate). Remove the inline `mode="edit"` UI, the
  `handleQtyChange`/`+Add item`/inline steppers, and the now-dead `updateOrderItems(order.id, notes, items, …)`
  call at ~L310 (QuickOrder is the sole editor now). The salesman Edit already routes here — unchanged.
- **`src/app/new-order/page.tsx` (edit loader):** it's `pending_approval`-only today (~L132). Widen so **admin**
  can load **any non-cancelled** order for edit; salesman/accountant stay `pending_approval`-only. Pass to
  `NewOrderFlow`: the order's **status**, the caller's **role**, the current **retailer_id**, and a derived
  **`requiresReason`** (= admin && status ≠ pending_approval).

## 4. `NewOrderFlow` / `QuickOrder` — the editor extensions
- **Retailer picker (admin only):** in the edit flow, if the caller is admin, allow changing the retailer (reuse
  the existing retailer-search step/picker the flow already has for a new order). Salesman/accountant: retailer is
  fixed (no picker). Thread the chosen `retailerId` into the submit.
- **Per-line price fields (admin, all brands):** in the edit cart, an admin gets an editable **price input per line
  for every brand** (fixed included), pre-filled with the line's current rate (`parsePricePaise` in, `formatRupees`
  out). Non-admin: prices behave as today (LG manual entry; fixed shown read-only from the catalog). Feed the edited
  prices into the `prices` map the submit sends.
- **Reason BottomSheet on Confirm** — when the caller **is admin** and **`requiresReason`** (post-approval): the
  final Confirm/submit opens a `BottomSheet` (mirror the Mark-billed `confirmProcess` sheet) titled e.g. **"Reason
  for this change?"** with a **required** textarea; on submit → call `updateOrderItems(id, notes, items, reason,
  prices, retailerId)`. Empty reason blocks submit. If **not** `requiresReason` (pending edit, or salesman/
  accountant) → **no sheet**, submit directly.
- After submit: route to the detail via the existing role-aware `detailBase` (staff → `/dashboard/orders`).

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Admin full-edit works** at `pending_approval` (no reason) and **post-approval** (reason required + logged
  `edited_after_lock`): items, per-line prices, and the **retailer** all change and persist.
- **Fixed-price override:** an **admin** changing a Zebronics/Luminous line price → **honored**; a **salesman** or
  **accountant** sending a fixed price → **ignored** (catalog/snapshot wins — untamperable holds). Prove all three live.
- **Retailer edit is admin-only:** a non-admin's `p_retailer_id` is ignored; the order's retailer is unchanged.
- **Reason gating:** admin post-approval confirm → the sheet fires and an empty reason is rejected; a pending edit
  (or salesman/accountant) → no sheet.
- **P5b intact:** an existing line edited with no new price keeps its snapshot (not re-priced to the default).
- **Salesman/accountant unchanged:** salesman edits own pending via QuickOrder; accountant pending-only; neither can
  change the retailer or a fixed price.
- `npm run build` + `tsc` + eslint clean; types regenerated; migration reconciled; the inline editor is gone (no dead code).

## Guardrails
- **Untamperable stays for everyone but the admin** — fixed-brand client prices ignored for salesman/accountant;
  the admin override is the deliberate, **server-enforced** exception (not a UI-only gate).
- **Retailer edit is admin-only**, server-enforced.
- **Reason required** for admin post-approval edits (`edited_after_lock`); wire the "post-approval-only vs always"
  as a single condition so it can flip later.
- Money in paise end-to-end; **snapshot immutability preserved** except an explicit admin override; don't touch the
  ceiling / `>0` rule, the who-may-edit matrix, or `submit_order`.
- **This is NOT the step-back / go-back feature** (that's a separate spec) and **NOT sale returns** — edits only.
