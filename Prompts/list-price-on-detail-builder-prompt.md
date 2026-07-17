# Builder prompt — List price vs charged price on the order detail

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-17** · grounded against the live schema + `submit_order`/`update_order_items`/`order-detail-data.ts`/`OrderDetailView.tsx`.

## Goal, one line
On the order detail, show **what each item's price was *supposed* to be (the list/reference) next to what the salesman actually charged**, plus an order-level discount summary — so an admin approving (or anyone) instantly sees where and how much was discounted. On-screen only (not the PDF pick slip).

## What "list price" is (per brand)
- **Manual brands (LG / Other / Bajaj):** the salesman types the price; the **list is the product's imported default `products.price_paise`** (the reference). This is the main case — "reference ₹500, sold ₹450."
- **Fixed brands (Zebronics / Luminous):** charged == catalog price, so list == charged → **nothing shows**… unless an **admin overrode** the price (admin full-edit), which then usefully surfaces as a gap.
- **One rule covers both: show the comparison only when charged ≠ list.**

## Decisions (LOCKED — owner 2026-07-17)
- **Snapshot** the list price onto the line at order time (`order_items.list_price_at_order` = `products.price_paise` at insert) — never a live lookup (a later catalog re-price must not rewrite an old order's "list"). Rides the same two insert points we just used for `stock_at_order`.
- **Per line — "struck list + charged inline"** in the RATE column, only when `list_price_at_order` is present AND ≠ the charged rate:
  ```
  RATE
  ~~₹45,000~~ ₹42,000
              −7%
  ```
  (list struck-through, charged beside it, signed delta beneath). Equal/no-list → just the charged rate as today.
- **Order-level summary** near the Total, shown only when the order's list-total ≠ charged-total:
  ```
  List   ₹1,20,000
  Total  ₹1,11,000  (−7.5%)
  ```
- **Delta sign:** discount (charged < list) = negative (`−7%`); markup = `+`. `(charged − list) / list`.
- **Every role** on the order detail (the shared component). **No backfill** — historical lines stay NULL → no comparison shown (correct; do **not** backfill from current price, that would fabricate discounts on old orders).

## Current state (verified — build against this)
- **`order_items`** now has `stock_at_order`; add **`list_price_at_order integer`** (nullable, paise) beside it. `unit_price_paise` is the **charged** snapshot (already there).
- **`submit_order`** loads `v_product` per line and inserts the line — add `list_price_at_order = v_product.price_paise` (the same insert that got `stock_at_order`). For a fixed brand `v_product.price_paise` == the charged rate → no gap; for manual it's the default → gap when the salesman priced off it.
- **`update_order_items`** — add `list_price_at_order = v_product.price_paise` to the **new-line INSERT only**; leave the existing-line UPDATE untouched (an edit must not rewrite the order-time list — and this is what lets an admin's price override on an existing line show up as a gap against the captured list).
- **`order-detail-data.ts`** ([src/components/orders/order-detail-data.ts](../src/components/orders/order-detail-data.ts)): `ORDER_DETAIL_SELECT` `order_items(...)` embed + `OrderDetailItemRow` — add `list_price_at_order`. Single source for all three detail routes.
- **`OrderDetailView.tsx`** line table is **ITEM · QTY · RATE · AMOUNT**; the RATE cell is `<td …>{formatRupees(line.rate)}</td>` where `line.rate` = `unit_price_paise`. The total row ([~L797](../src/components/orders/OrderDetailView.tsx#L797)) shows `Total (incl. GST) {formatRupees(order.totalPaise)}`. Add `list_price_at_order` to its `OrderItemRow` + map it into `line` (as `listPriceAtOrder`). Money is paise → **`formatRupees` only**; the delta % is a plain number.
- **Prod caution:** app + DB LIVE. Branch off `main`. **Commit 1 is a DB migration — hold until the owner says go.**

---

## Commit 1 — DB: `list_price_at_order` + capture  ⚠️ owner-approval-gated
Migration `YYYYMMDDHHMMSS_order_line_list_price.sql` (apply via MCP, reconcile filename to the ledger):
1. `alter table public.order_items add column list_price_at_order integer;` (nullable; instant, no rewrite). **No backfill.**
2. `create or replace function public.submit_order(...)` — from its **current** body, add `list_price_at_order = v_product.price_paise` to the `order_items` insert.
3. `create or replace function public.update_order_items(...)` — from its **current** body, add `list_price_at_order = v_product.price_paise` to the **new-line INSERT only**.

**Acceptance (reviewer verifies live, rolled back):** a new **manual**-brand order where the salesman prices below the default captures `list_price_at_order = default` and `unit_price_paise = entered` (gap); a **fixed**-brand order captures `list_price_at_order = unit_price_paise` (no gap); a manual product with a NULL default → `list_price_at_order` NULL; an admin full-edit **adds** a line capturing its list, and editing an **existing** line's price leaves `list_price_at_order` intact (so the override shows as a gap); no other change. Commit: `feat(db): order_items.list_price_at_order snapshot in submit_order + update_order_items`.

## Commit 2 — FE: struck list + charged, and the order summary
- **`order-detail-data.ts`:** add `list_price_at_order` to the embed + `OrderDetailItemRow` (`number | null`).
- **`OrderDetailView.tsx`:**
  - Add `list_price_at_order` to `OrderItemRow`; map to `line.listPriceAtOrder`.
  - **RATE cell:** when `listPriceAtOrder != null && listPriceAtOrder !== line.rate`, render the **struck list** (`formatRupees(listPriceAtOrder)` with strike-through) + the charged `formatRupees(line.rate)`, and a signed delta `round((rate - list) / list * 100)` beneath (muted, e.g. `−7%`). Otherwise render `formatRupees(line.rate)` as now. Keep it legible in the numeric column, light + dark.
  - **Order summary** in/next to the total row: compute `listTotal = Σ (listPriceAtOrder ?? rate) × (pickedQty ?? qty)` and compare to `order.totalPaise` (the charged Total). If they differ, render a **List ₹listTotal → ₹order.totalPaise (−Z%)** line (Z = `round((total - listTotal)/listTotal*1000)/10`). If equal (no line off-list) render nothing new. Class-based styling; a count-free % is not money.

**Acceptance:** a discounted manual line shows the struck list + charged + delta; a fixed/at-list line shows only the rate; the order summary appears only when something was off-list and its numbers reconcile with the shown Total; every role sees it; historical orders (NULL list) show no comparison; `tsc`/`eslint`/`build` clean. Commit: `feat(orders): list-vs-charged price on the order detail (struck list + order discount summary)`.

## Guardrails
- Branch off `main`; **DB migration only after owner OK**; Commit 2 DB-free.
- Read newest `comments.md`; fix any ❌.
- Paise → `formatRupees` only; the delta % is derived, display-only. `list_price_at_order` is an immutable order-time snapshot — never recompute or backfill it.
- Commit messages literally accurate — the REVIEWER verifies by execution.
