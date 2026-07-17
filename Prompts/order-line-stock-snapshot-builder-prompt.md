# Builder prompt — Order-line stock snapshot (captured at order time)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-17** · grounded against the live prod schema + `submit_order`/`update_order_items`/`order-detail-data.ts`.

## Goal, one line
Snapshot each order line's **stock at the moment of ordering** (a static, historical fact — never recomputed live) and surface it on the **order-detail page for every role** as a small pill that flags **only problems**: out-of-stock / partial (red) and not-on-Tally (orange). In-stock lines show **nothing**.

## Why (context)
Stock (`products.stock_qty`, synced from Tally) is advisory — ordering never blocks or decrements it, and partial *fulfilment* happens later at the godown pick (short-pick → backorder split). This feature just **records what stock looked like when the order was placed**, so anyone reading the order later can see "this line was short/unavailable at order time." It is **not** a reservation and does **not** change ordering behaviour.

## Decisions (LOCKED — owner 2026-07-17)
- **Store** the raw number, derive the pill on display. One nullable column `order_items.stock_at_order` = the product's `stock_qty` at insert time.
- **Pill, per line** (compare `stock_at_order` to the line's `qty`):

  | `stock_at_order` | Pill text | Colour |
  |---|---|---|
  | `NULL` (product not on Tally / never synced) | **N/A** | 🟠 orange (`--color-amber`) |
  | `0` | **Out of Stock** | 🔴 red (`--color-error`) |
  | `0 < stock_at_order < qty` | **Partial Stock: {stock_at_order}/{qty}** | 🔴 red |
  | `>= qty` | *(nothing — in stock)* | — |

- **Shown to every role** on the order detail (salesman + staff + godown).
- **Orange, not yellow** (owner: more see-able). Use the existing `--color-amber` (#b45309).
- Mirrors the Quick Order pills, but static (the snapshot, never live).

## Current state (verified — build against this)
- **`order_items`** columns: `id, order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position, picked_qty`. **No `stock_at_order` yet.** `product_name`/`unit_price_paise` are already order-time snapshots — `stock_at_order` joins them.
- **`submit_order(p_id, p_retailer_id, p_notes, p_items)`** loads `v_product` per line (`select * into v_product from products …`) and inserts:
  ```sql
  insert into public.order_items (order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position)
  values (p_id, v_product.id, v_product.name, v_unit_price, v_qty, v_unit_price::bigint * v_qty, v_item_count);
  ```
  → add `stock_at_order` = `v_product.stock_qty` to this insert.
- **`update_order_items(...)`** (admin full-edit) has a **new-line INSERT** (same column list, `v_product` loaded per line) and a separate **existing-line UPDATE**. Add `stock_at_order = v_product.stock_qty` to the **new-line INSERT only** — leave the existing-line UPDATE untouched (an edit must not rewrite an order-time snapshot).
- **`order-detail-data.ts`** ([src/components/orders/order-detail-data.ts](../src/components/orders/order-detail-data.ts)) is the **single** source for all three detail routes (`dashboard/orders/[id]`, `orders/[id]`, `godown/orders/[id]`): `ORDER_DETAIL_SELECT` has the `order_items(...)` embed and `OrderDetailItemRow`/`toOrderDetailProps`. Touch this one file, not the three pages.
- **`OrderDetailView.tsx`** renders the line items and has its **own** `OrderItemRow` interface (must add the field there too — structural match). Money is paise; **`stock_at_order` is a plain count, never money** (no `formatRupees`).
- **Prod caution:** app + DB LIVE. Branch off `main`. **Commit 1 is a DB migration — hold until the owner says go.**

---

## Commit 1 — DB: `stock_at_order` + capture in the two insert paths  ⚠️ owner-approval-gated
Migration `YYYYMMDDHHMMSS_order_line_stock_snapshot.sql` (apply via MCP, reconcile filename to the ledger):
1. `alter table public.order_items add column stock_at_order integer;` (nullable; instant, no rewrite).
1b. **Backfill existing rows** (owner 2026-07-17): `update public.order_items set stock_at_order = qty where stock_at_order is null;` — sets every pre-feature line to its **own ordered qty**, so it reads as **in-stock (no pill)** instead of a misleading N/A. **Use `= qty`, never a flat constant** — a flat 500 would wrongly flag any line with `qty > 500` as "Partial Stock: 500/600". After this, a NULL can only come from a *new* order of a product with no Tally stock → **N/A stays meaningful**.
2. `create or replace function public.submit_order(...)` — recreate from its **current** body, adding `stock_at_order` (value `v_product.stock_qty`) to the `order_items` insert.
3. `create or replace function public.update_order_items(...)` — recreate from its **current** body, adding `stock_at_order = v_product.stock_qty` to the **new-line INSERT only**.

**Acceptance (reviewer verifies live, rolled back):** a new order (fixed + manual brand) captures `stock_at_order = products.stock_qty` per line (incl. NULL for an unsynced product and 0 for an out-of-stock one); an admin full-edit that **adds** a line captures its `stock_at_order`, while an **existing** edited line keeps its original snapshot; the **backfill** left every pre-existing line at `stock_at_order = qty` (no historical NULLs); no other column/behaviour changes. Commit: `feat(db): order_items.stock_at_order snapshot + backfill existing to qty`.

## Commit 2 — FE: the per-line stock pill
- **`order-detail-data.ts`:** add `stock_at_order` to the `order_items(...)` embed in `ORDER_DETAIL_SELECT`, and `stock_at_order: number | null` to `OrderDetailItemRow`. (`toOrderDetailProps` passes items through — no mapping change.)
- **`OrderDetailView.tsx`:** add `stock_at_order: number | null` to its `OrderItemRow`; render a pill on each line item from the mapping above — **render nothing when `stock_at_order >= qty`**. A small helper keeps it tidy, e.g.:
  ```
  stock_at_order == null            → { text: "N/A", tone: "na" }        // orange
  stock_at_order === 0              → { text: "Out of Stock", tone: "short" } // red
  stock_at_order < qty              → { text: `Partial Stock: ${stock_at_order}/${qty}`, tone: "short" } // red
  else                              → null (no pill)
  ```
  Two CSS classes (`--color-error` red / `--color-amber` orange), light + dark legible, class-based not inline. Place the pill on/under the line so it reads at a glance (mirror the Quick Order pill feel).

**Acceptance:** every role's order detail shows the pill on short/out/na lines and **nothing** on in-stock lines; text + colour match the table; a partial line reads "Partial Stock: 5/7"; `tsc`/`eslint`/`build` clean. Commit: `feat(orders): per-line stock-at-order pill on the order detail (all roles)`.

## Guardrails
- Branch off `main`; **DB migration only after owner OK**; Commit 2 DB-free.
- Read newest `comments.md` first; fix any ❌.
- `stock_at_order` is a count, never money. Snapshot is immutable — never recompute or backfill it live.
- **Historical rows are backfilled to `= qty`** (step 1b) so they show no pill and NULL stays meaningful. Do **not** backfill from *current stock* (that's a wrong order-time value); `= qty` just means "treat as fully covered / unknown."
- Commit messages literally accurate — the REVIEWER verifies by execution.
