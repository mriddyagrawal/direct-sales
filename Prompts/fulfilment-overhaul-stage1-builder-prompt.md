# Builder prompt — Stage 1: Fulfilment for all brands · brand-aware picking · partial → backorder

A reshape of the fulfilment stage (approval → `ready_to_bill`). **All** brands now
go through the godown after approval; the godown picks **brand-aware** (LG scans
serials, Zeb/Lum enter picked quantities); a pick may be **partial**, which splits
the order — the original ships what was picked, and a **new backorder** captures the
rest as a **Backorder** to be re-`Punch`ed into the pipeline. Context:
[docs/specs/order-lifecycle.md](../docs/specs/order-lifecycle.md),
[docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md).

> **Stage 2** ([godown-dispatch-fulfilment](godown-dispatch-fulfilment-builder-prompt.md))
> builds the godown Pickup/Dispatch/History tabs + the `dispatched` status **on top of
> this**. Do Stage 1 first. Overlap note: Stage 2's "Pickup = approved LG only" is
> replaced here by all-brand pickup — Stage 2 inherits it.

## Owner decisions (all locked)
1. **All brands → `approved` after approval** — Zeb/Lum no longer skip to `ready_to_bill`.
   `approved` becomes a generic **"to fulfil"** stage; the godown touches every order.
2. **Brand-aware pick:** LG (`requires_scan`) = scan serials (existing scanner);
   Zeb/Lum = a **per-line picked quantity**. No serials for fixed brands.
3. **Partial picking, all brands** (LG scans fewer serials; Zeb/Lum enters a smaller
   qty). Full coverage is no longer required.
4. **Partial → split:** the **original** order keeps its number and **ships the picked
   quantities**; a **new child order** (created at pick-submit time, **same salesman**,
   linked to the parent) holds the remainder in a new **`backorder`** status.
5. **`backorder` → `pending_approval` via a "Punch Order" action.** Backorders are
   **visible to everyone** (the salesman sees his backorders + the linked orders).

## New vocabulary
- Relabel `approved`: the chip "Waiting for scan" → **"To pick"** (brand-agnostic; the
  scan-vs-pick difference lives *inside* the godown screen). **Keep the status value
  `approved`** — label only.
- New status **`backorder`** ("Backorder") — sits **before** `pending_approval`. A backorder is
  born here; **Punch Order** promotes it. It's editable until punched.

## The lifecycle now
```
backorder ──Punch Order──▶ pending_approval ──approve (admin)──▶ approved  ("To pick", ALL brands)
      ──godown picks (LG: scan · Zeb/Lum: qty; partial ok)──▶ ready_to_bill ──▶ billed ──▶ dispatched(S2)
   partial pick → original ships picked qty (→ ready_to_bill) + a NEW child order (remainder) in `backorder`
```

## 1. Migration (14-digit `YYYYMMDDHHMMSS`, no `T`; via MCP; reconcile the filename)
- **`order_items`:** add `picked_qty integer` (nullable — the fulfilled amount). The
  ordered `qty` / `unit_price_paise` / `line_total_paise` stay **immutable** (the placed
  snapshot — do not rewrite them).
- **`orders`:** add `parent_order_id uuid references public.orders(id)` (a backorder's
  link to the order it split from; null otherwise).
- **Status CHECK:** add `'backorder'` →
  `('backorder','pending_approval','approved','ready_to_bill','billed','cancelled')`.
  (**Stage 2 is parked** — do NOT add `dispatched` here; Stage 2 adds it later.)
- **`approve_order`:** route **every** brand to `approved` (drop the
  `requires_scan ? 'approved' : 'ready_to_bill'` branch). Admin-only stays.
- **`guard_order_transition`:**
  - add `backorder → pending_approval` (the punch — salesman-owner or admin).
  - **remove** the `pending_approval → ready_to_bill` edge (fixed brands now go via
    `approved`, not straight through).
  - keep `approved → ready_to_bill` (the pick, any role per universal-scan).
- **The pick RPC (`submit_pick`)** — make it brand-aware + partial + splitting:
  - Input per line: `picked_qty`, and for LG the `raw_scan`s for the picked units.
  - **LG (`requires_scan`):** picked_qty = the number of serials submitted for that line;
    extract + store serials server-side for the picked units (as today, incl. within-bill
    dedup). Partial = fewer serials than ordered.
  - **Zeb/Lum:** `picked_qty` comes from the client (integer, `0 ≤ picked ≤ ordered`); no
    serials.
  - **Validate:** per line `0 ≤ picked_qty ≤ qty`; **at least one unit picked across the
    order** (else reject — nothing to ship, leave it in the queue); for LG, serial count
    == picked_qty.
  - Set `order_items.picked_qty` per line; **recompute `orders.total_paise =
    Σ(picked_qty × unit_price_paise)`** (the shipped total; the immutable line snapshots
    stay as the ordered record). Transition → `ready_to_bill`; stamp `picked_at/by`; log a
    `picked` event with an ordered-vs-picked summary.
  - **Split when any line is short** (`picked_qty < qty`): create a **child order** —
    new `order_no` (from `order_no_seq`, gapless), new `order_ref`, status **`backorder`**,
    `parent_order_id` = original, **`salesman_id` = original's** (SECURITY DEFINER →
    RLS is a non-issue), same retailer/brand/notes, `submitted_at = now()`. Child
    `order_items`: one per shorted line, `qty = ordered − picked`, same `product`, same
    `unit_price_paise` (carried snapshot), `line_total = qty×price`, `picked_qty` null;
    fully-picked lines omitted. Child `total_paise = Σ` remainder. Log a `backordered`
    event linking both.
  - Keep the godown/role gate + salesman-own scope (universal-scan), the `approved`
    status assert, and price-free selection.
- **`punch_order(p_order_id uuid)` RPC (new):** caller = the order's salesman **or**
  admin; order must be `backorder`; move `backorder → pending_approval`, set
  `submitted_at`/`editable_until`, log a `submitted` event. (It re-enters the normal
  pipeline and can itself be partially fulfilled later → another backorder.)
- **RLS:** widen the godown SELECT policies from `requires_scan`-gated to **all-brand
  `approved`** (the all-brand pick queue) — mirror on `order_items`/`order_item_scans`.
  (Stage 2 widens further to billed/dispatched.) The salesman already sees his own rows
  by `salesman_id`, so his `backorder`-status orders are visible to him automatically.
- **Regenerate** `src/lib/types/database.types.ts`.

## 2. Godown pick screen — brand-aware + partial (`/godown/[id]`, `PickScreen`)
- Branch on `requires_scan`:
  - **LG (scan):** the existing scanner, now **partial-capable** — drop the
    full-coverage requirement; show ordered-vs-scanned per line. **The submit/"Done"
    button lives on the scanning page itself and is pressable as soon as ≥1 unit is
    scanned** (owner call) — the picker does NOT have to scan the full quantity to
    finish. (Today it's gated on full coverage; enable it for a partial count.) The
    remainder backorders server-side.
  - **Zeb/Lum (qty):** **no scanner** — a per-line **stepper** for `picked_qty`
    (`0..ordered`), defaulting to the full ordered qty (the common all-in-stock case).
    The submit button is likewise pressable with any `≥1`-unit partial.
- Submit → the pick RPC; on partial the backorder is created server-side; return to the
  queue. Price-free (unchanged).

## 3. Backorder + shipped surfaces (`OrderDetailView`, `OrdersView`, status chips)
- **Order detail (shipped order):** show **picked (shipped) vs ordered** per line, and
  the backorder link ("2 units backordered → {child ref}").
- **Order detail (`backorder`):** show the parent link ("backorder of {parent ref}"), a
  **Punch Order** button (salesman-owner or admin), and allow **editing the quantities**
  before punching (it's a backorder — reuse the edit flow).
- **Order list:** `backorder` orders show up (add a **Backorder** chip + include in the tabs, e.g.
  a "Backorder" tab or fold into All); the salesman sees his backorders; everyone sees backorders.
- **Chips/tones:** relabel `approved` → **"To pick"**; add a `backorder` tone + **"Backorder"**.
- **`order-events.ts`:** describe `backordered` ("Backordered — {n} units → {ref}") and
  keep `picked` (now "Picked {picked}/{ordered}").

## Acceptance (reviewer verifies by execution — live, rolled back)
- **All brands fulfil:** a Zebronics order approved by admin lands in `approved` ("To
  pick"), appears in the godown queue, and the godown sets picked quantities → it moves
  to `ready_to_bill`. An LG order still scans.
- **Partial split (all brands):** picking 3 of a 5-qty line → original order ships 3
  (`total_paise` = 3×price, its ordered line snapshot untouched, `picked_qty=3`), and a
  **new `backorder` child** exists under the **same salesman**, `parent_order_id` set, with a
  2-qty remainder line. Prove for both an LG line (scan 3 of 5) and a Zeb/Lum line.
- **Punch:** the salesman (or admin) presses **Punch Order** on the backorder → it becomes
  `pending_approval` and flows normally; it can itself be partially picked → another backorder.
- **Visibility:** the salesman sees his backorder; it's visible to staff too.
- **Guards intact:** godown/role gate + salesman-own scope hold; ≥1 unit required to
  submit; LG serial count == picked_qty; within-bill serial dedup + server-side extraction
  unchanged; ordered snapshots (`qty`/`unit_price_paise`/`line_total_paise`) never rewritten.
- **Gapless order numbers:** the backorder draws a fresh `order_no` from the sequence (no
  gaps, no reuse).
- `npm run build` + `tsc` + eslint clean; types regenerated; migration reconciled.

## Guardrails
- **Immutability:** never rewrite the ordered line snapshot — `picked_qty` is additive;
  the shipped total is `Σ(picked_qty × unit_price_paise)`.
- **Money in paise**, `formatRupees` for display; billing is on the picked (shipped) qty.
- The backorder is created **server-side** under the original salesman (SECURITY DEFINER);
  no RLS/role change lets a client forge that.
- Fixed brands carry **no serials** (order_item_scans stays LG-only); godown screens stay
  price-free.
- Don't touch dispatch/the `dispatched` status (Stage 2) or approval being admin-only.
- Update `docs/specs/order-lifecycle.md` + `docs/godown-fulfilment-design.md` (all-brand
  fulfilment, `backorder`/Punch, partial + backorder split).
