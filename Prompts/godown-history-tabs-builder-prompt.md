# Builder prompt — Godown: Pickup / History bottom tabs + History page

Give the godown app the same two-tab shape the salesman has (Home / New Order): a bottom bar with **Pickup** (the existing queue, `/godown`) and **History** (`/godown/history`, the picks they've already done). Design context: [docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md).

## What History shows
The orders this role has already picked — i.e. `picked_at IS NOT NULL`: **`ready_to_bill`** (picked, awaiting the accountant's bill), **`processed`** (billed), and any **`cancelled`** order that had been picked. Read-only. Newest first by `picked_at`, bounded (~last 100). Per row: ref · retailer · picked-time · status chip (**Ready to bill / Billed / Cancelled** — reuse `getOrderStatusTag`) · and the **serials** that were scanned (tap to expand, or a simple detail). **No prices anywhere** (same as the pick screen — don't select price columns).

## 1. Migration — widen the godown RLS (the queue only, today, is approved+ready_to_bill)
`orders_select_godown` currently = `auth_profile_role()='godown' AND status IN ('approved','ready_to_bill') AND <approval brand>`. History needs the terminal picked states too. Widen the **three** godown SELECT policies to also allow `processed` and `cancelled` **for approval (LG) brands**:
- `orders_select_godown` → `status IN ('approved','ready_to_bill','processed','cancelled')` (keep the `requires_approval` brand gate).
- `order_items_select_godown` and `order_item_scans_select_godown` → mirror (so History can show the lines + serials of past picks).
- Purely additive **SELECT** widening — no write policies, no new columns. Standard **14-digit filename, no `T`** (per the ㉝ reconciliation); apply via MCP and reconcile the repo filename to the ledger version. Regenerate types if needed (no schema change, so likely unnecessary).
- **Verify by execution:** godown can now read a `processed`/`cancelled` LG order + its scans, but **still cannot** read a fixed-brand (Zebronics/Luminous) order of any status. The pickup queue (`/godown`) must still only list `approved` (filter in the query, unchanged).

## 2. Bottom tab bar — `GodownTabBar`
Mirror `src/components/BottomTabBar.tsx`: two destinations — **Pickup** (`/godown`) and **History** (`/godown/history`), active state by `usePathname`. Render it on the **queue** and **History** pages only — **NOT on the active pick screen** (`/godown/[id]`), which already has its own submit bar and is a focused flow (same reason the salesman's new-order flow hides the tab bar). Add bottom padding on the two pages so the fixed bar doesn't cover content.

## 3. History page — `/godown/history`
- Server component, **gated to `godown`** exactly like `/godown` (fetch caller role; redirect non-godown). 
- Query orders where `picked_at is not null` (RLS already scopes to godown-visible LG orders), `order("picked_at", desc)`, limit ~100 — select ref, retailer name, `picked_at`, status, `editable_until` (for the tag), and `order_items(product_name, qty, order_item_scans(serial))`. **No price columns.**
- Render the list (mobile cards): ref, retailer, "picked {time}", status chip; tapping a row reveals its lines + scanned serials (read-only). Empty state ("No picks yet.").
- Add `<GodownTabBar />` + bottom padding.

## 4. Pickup page (`/godown`)
- Add `<GodownTabBar />` + bottom padding. It's the "Pickup" tab. The queue query/logic is unchanged (still only `approved`).

## Acceptance (reviewer + owner phone test)
- A godown user sees a bottom bar with **Pickup** and **History**; Pickup lists the approved queue (unchanged), History lists their past picks (ready_to_bill / billed / cancelled) with the scanned serials, no prices.
- The active pick screen (`/godown/[id]`) shows **no** tab bar (keeps its submit bar).
- RLS: godown can read past LG picks + scans; a fixed-brand order stays invisible to godown at every status (execute to prove).
- Non-godown users still can't reach `/godown/*` (middleware unchanged).
- `npm run build` + `tsc` + eslint clean.

## Guardrails
- Godown-only, read-only. The RLS change is **additive SELECT** for approval brands + picked states — no write policies, no other role affected, no new columns.
- Prices are never selected/rendered on any godown screen.
- Don't regress the pickup queue (approved-only), the pick/scan flow, `submit_pick`, or the accountant/salesman views.
