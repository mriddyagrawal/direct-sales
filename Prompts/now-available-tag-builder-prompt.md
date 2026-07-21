# Builder prompt — Order detail: "Now available" recovery tag on order-time-short lines

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-21** · grounded against the live order-detail view. **FE-only + one column added to an existing embed — NO DB migration.**

## What & why
The order-detail line already shows an **immutable order-time stock pill** (red): `"Out of stock"` or `"Partial stock · available N"` when the product was short at the moment the order was placed ([OrderDetailView.tsx:44](../src/components/orders/OrderDetailView.tsx#L44) `stockAtOrderPill`). That pill is a historical snapshot and must stay exactly as-is.

Owner wants a **green live-availability tag** layered *next to* that red pill on any line that **was short at order time**, showing how much of that product is **currently** in the godown (via Tally sync) — a backorder-recovery readout: "you were short; here's what you can fill now." It is a **live count**, not a binary "fully covered" flag.

Owner-locked decisions (2026-07-21):
- **Fires only if the line was short at order time** — i.e. only when `stockAtOrderPill(...)` is non-null (out of stock OR partial). A line that was in stock at order time never gets the tag.
- **Label = current live stock vs the ordered qty** (`current = products.stock_qty`):
  - `current >= line.qty` → **`Now available`** (the whole line is fillable now).
  - `0 < current < line.qty` → **`{current} available`** (partial — e.g. `2 available`; the exact count so they know how many they can fill).
  - `current == 0` or `null` → **no green tag** (still nothing to fill — red order-time pill stands alone).
- **Show BOTH** — keep the red order-time pill AND add the green tag beside it (the recovery story: ~~was short~~ → what's here now). Do not hide or alter the red pill.
- **Only on not-yet-fulfilled orders** — statuses `backorder`, `pending_approval`, `approved`, `ready_to_bill`. **Hidden** on `billed`, `dispatched`, `cancelled` (done → the tag is noise there). This gate applies to the GREEN tag only; the red order-time pill's behavior is unchanged (still shows on every status).
- **All roles** (same audience as the existing red pill).
- The count is **current total godown stock**, mirroring the red pill's own "available N" voice — same as the order-time pill but live instead of the snapshot.

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
Add a small helper next to `stockAtOrderPill` (same file, top) that returns the live-availability label or null:
```ts
// GREEN live tag on a line that was short at order time: how many are in the
// godown NOW. ≥ ordered qty → "Now available"; 1..qty-1 → "N available";
// 0/NULL → null (still stuck). Guard `wasShort` + status at the call site.
function nowAvailableTag(current: number | null, qty: number): string | null {
  if (current == null || current <= 0) return null;
  return current >= qty ? "Now available" : `${current} available`;
}
```
At the pill render site ([OrderDetailView.tsx:765-768](../src/components/orders/OrderDetailView.tsx#L765)), keep the red pill and add the green tag under the owner-locked gates. Define the not-yet-fulfilled set once (reuse an existing status constant/helper if one exists — do not invent a parallel source of truth):

```tsx
const NOT_FULFILLED = ["backorder", "pending_approval", "approved", "ready_to_bill"];
// ...
{(() => {
  const pill = stockAtOrderPill(line.stockAtOrder, line.qty);      // red order-time snapshot, unchanged
  // Live tag only on lines that were short at order time (pill !== null) and
  // on not-yet-fulfilled orders. `nowAvailableTag` handles the 0/partial/full split.
  const liveTag =
    pill !== null && NOT_FULFILLED.includes(order.status)
      ? nowAvailableTag(line.currentStock, line.qty)
      : null;
  return (
    <>
      {pill && <span className={styles.stockAtOrderPill}>{pill}</span>}
      {liveTag && <span className={styles.nowAvailablePill}>{liveTag}</span>}
    </>
  );
})()}
```
- `liveTag` requires `pill !== null`, so it only ever appears alongside a red pill — never on its own, never on an always-in-stock line.
- `currentStock == null` (line has no product link, or the product row has null stock) or `0` → no green tag. Correct — unknown/none ≠ available.
- Edit-mode lines with no `extra` → `currentStock` null → no tag. Fine.
- Edge (owner-accepted, intentional): the count is *current* stock, so if a partial line's stock has since **dropped** (order-time available 5, now 2), the green tag reads the truthful current `2 available` even though it's lower than the snapshot. The tag always means "what's in the godown right now," not "improvement since order."

## Styling — green tag mirroring the red pill
Add `.nowAvailablePill` to [OrderDetailView.module.css](../src/components/orders/OrderDetailView.module.css), structurally identical to `.stockAtOrderPill` (dot + 11px/600 text) but in the app's **green in-stock tone `var(--color-processed)`** (the same token Quick Order's `.stockIn` uses). Copy the `::before` dot rule. Keep both pills on the same line (a small gap between the red and green) rather than stacked — they read as one "was short → now back" statement.

## Acceptance (verify by execution — the REVIEWER will)
Take a line **out-of-stock / partial at order time** on a not-yet-fulfilled order (e.g. `approved`); vary the product's **current** `stock_qty`:
- current **≥ ordered qty** → red order-time pill **and** green **`Now available`**.
- current **between 1 and qty-1** → red order-time pill **and** green **`{current} available`** (e.g. `2 available`).
- current **0** (or null) → red pill only, **no** green tag.
- Line **in stock at order time** → nothing, regardless of current stock (no red pill ⇒ no green tag).
- Any recovered line but order is `billed` / `dispatched` / `cancelled` → **no** green tag (red order-time pill still shows, unchanged).
- Salesman, admin, and accountant all see it; salesman still loads his own order detail (no RLS regression).
- `tsc` / `eslint` / `build` clean.
- Commit: `feat(orders): live "Now available"/"N available" tag on order-time-short lines (current godown stock vs ordered qty)`.

## Guardrails
- **FE + one embed column only — no DB migration, no RPC, no mutation.** This is a live-computed display hint.
- Do **not** touch `stockAtOrderPill` or the red pill's markup/behavior — the order-time snapshot is immutable and stays on all statuses.
- Keep the `products` embed column list in sync across `order-detail-data.ts` and the `OrderItemRow` type in `OrderDetailView.tsx` (drift breaks the row).
- Known limitation (owner-accepted, do NOT try to solve): `stock_qty` is total godown stock, not reserved per order — two open orders for the same product can both show "Now available" though only one can ship. This is an informational nudge, not a reservation.
- Read the newest `comments.md` review blocks first. Commit message must be literally accurate — the REVIEWER verifies by execution.
