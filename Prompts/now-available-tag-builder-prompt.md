# Builder prompt — Order detail: "Now available" recovery tag on order-time-short lines

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-21** · grounded against the live order-detail view. **FE-only + one column added to an existing embed — NO DB migration.**

## What & why
The order-detail line already shows an **immutable order-time stock pill** (red): `"Out of stock"` or `"Partial stock · available N"` when the product was short at the moment the order was placed ([OrderDetailView.tsx:44](../src/components/orders/OrderDetailView.tsx#L44) `stockAtOrderPill`). That pill is a historical snapshot and must stay exactly as-is.

Owner wants a **green "Now available" tag** layered *next to* that red pill when a line that **was short at order time** has since been **restocked** (via Tally sync) enough to **fully cover the order** — a backorder-recovery nudge: "this shortage is resolved, you can fill it now."

Owner-locked decisions (2026-07-21):
- **Fires only if the line was short at order time** — i.e. only when `stockAtOrderPill(...)` is non-null (out of stock OR partial). A line that was in stock at order time never gets the tag.
- **"Fully covers"** = current live stock **≥ the full ordered qty** (`currentStock >= line.qty`). Not the shortfall — the whole line must be fillable.
- **Show BOTH** — keep the red order-time pill AND add the green tag beside it (the recovery story: ~~was short~~ → now available). Do not hide or alter the red pill.
- **Only on not-yet-fulfilled orders** — statuses `backorder`, `pending_approval`, `approved`, `ready_to_bill`. **Hidden** on `billed`, `dispatched`, `cancelled` (done → the tag is noise there). This gate applies to the GREEN tag only; the red order-time pill's behavior is unchanged (still shows on every status).
- **All roles** (same audience as the existing red pill).

## Data — add current live stock to the line (one column, no migration)
Current godown stock is `products.stock_qty` (updated by each Tally sync). The line already embeds the product; just widen it:
1. [order-detail-data.ts:19](../src/components/orders/order-detail-data.ts#L19) — in `ORDER_DETAIL_SELECT`, change `products(tally_name)` → `products(tally_name, stock_qty)`.
2. [order-detail-data.ts:44](../src/components/orders/order-detail-data.ts#L44) — `OrderDetailItemRow.products`: add `stock_qty: number | null`.
3. [OrderDetailView.tsx:35](../src/components/orders/OrderDetailView.tsx#L35) — the local `OrderItemRow.products`: add `stock_qty: number | null`.

RLS: the embed already returns `products.tally_name` for **every** role (incl. the salesman on his own orders); `stock_qty` is on the same product row, so no policy change is needed. Verify the salesman still resolves his own order detail after the change.

## Thread `currentStock` into the line view model
Mirror how `stockAtOrder` is already carried:
- [OrderDetailView.tsx:185-208](../src/components/orders/OrderDetailView.tsx#L185) `lineExtraByProduct` — add `currentStock: number | null` to the Map value type and set `currentStock: it.products?.stock_qty ?? null`.
- [OrderDetailView.tsx:216-226](../src/components/orders/OrderDetailView.tsx#L216) `lines` map — add `currentStock: extra?.currentStock ?? null`.

## Render — layer the green tag beside the red pill
At the pill render site ([OrderDetailView.tsx:765-768](../src/components/orders/OrderDetailView.tsx#L765)), keep the red pill and add the green tag under the owner-locked condition. Define the not-yet-fulfilled set once (reuse an existing status constant/helper if one exists — do not invent a parallel source of truth):

```tsx
const NOT_FULFILLED = ["backorder", "pending_approval", "approved", "ready_to_bill"];
// ...
{(() => {
  const pill = stockAtOrderPill(line.stockAtOrder, line.qty);      // red, unchanged
  const nowAvailable =
    pill !== null &&                                                // was short at order time
    line.currentStock != null &&
    line.currentStock >= line.qty &&                               // current stock fully covers the line
    NOT_FULFILLED.includes(order.status);                          // pre-fulfillment only
  return (
    <>
      {pill && <span className={styles.stockAtOrderPill}>{pill}</span>}
      {nowAvailable && <span className={styles.nowAvailablePill}>Now available</span>}
    </>
  );
})()}
```
- `nowAvailable` already requires `pill !== null`, so it can only appear alongside a red pill — never on its own, never on an always-in-stock line.
- `currentStock == null` (line has no product link, or the product row has null stock) → no green tag. Correct — unknown ≠ available.
- Edit-mode lines with no `extra` → `currentStock` null → no tag. Fine.

## Styling — green tag mirroring the red pill
Add `.nowAvailablePill` to [OrderDetailView.module.css](../src/components/orders/OrderDetailView.module.css), structurally identical to `.stockAtOrderPill` (dot + 11px/600 text) but in the app's **green in-stock tone `var(--color-processed)`** (the same token Quick Order's `.stockIn` uses). Copy the `::before` dot rule. Keep both pills on the same line (a small gap between the red and green) rather than stacked — they read as one "was short → now back" statement.

## Acceptance (verify by execution — the REVIEWER will)
- Line **out-of-stock / partial at order time**, order status `approved` (or any not-yet-fulfilled), product's current `stock_qty` **≥ ordered qty** → shows the red order-time pill **and** the green "Now available".
- Same line but current `stock_qty` **< ordered qty** → red pill only, **no** green tag.
- Line **in stock at order time** → nothing, regardless of current stock (no red pill ⇒ no green tag).
- Same recovered line but order is `billed` / `dispatched` / `cancelled` → **no** green tag (red order-time pill still shows, unchanged).
- Salesman, admin, and accountant all see it; salesman still loads his own order detail (no RLS regression).
- `tsc` / `eslint` / `build` clean.
- Commit: `feat(orders): "Now available" tag on recovered short lines (order-time shortfall + current stock covers qty)`.

## Guardrails
- **FE + one embed column only — no DB migration, no RPC, no mutation.** This is a live-computed display hint.
- Do **not** touch `stockAtOrderPill` or the red pill's markup/behavior — the order-time snapshot is immutable and stays on all statuses.
- Keep the `products` embed column list in sync across `order-detail-data.ts` and the `OrderItemRow` type in `OrderDetailView.tsx` (drift breaks the row).
- Known limitation (owner-accepted, do NOT try to solve): `stock_qty` is total godown stock, not reserved per order — two open orders for the same product can both show "Now available" though only one can ship. This is an informational nudge, not a reservation.
- Read the newest `comments.md` review blocks first. Commit message must be literally accurate — the REVIEWER verifies by execution.
