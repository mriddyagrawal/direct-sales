# Admin step-back — the "Undo" button (spec)

**Status:** design captured 2026-07-16; **all decisions LOCKED 2026-07-17 (owner). Ready to build.** Relates to [order-lifecycle.md](order-lifecycle.md), [roles-and-permissions.md](roles-and-permissions.md), and the cancel/edit matrices.

## Goal
Let the **admin** walk an order **one step backward** through the lifecycle to **correct a mistake** — approved too early, billed with the wrong number, dispatched before it should have been. Admin-only, one step at a time, one tap + an "are you sure?" confirm.

## What this is NOT — the key distinction
Step-back fixes **mistakes** (an order that shouldn't have advanced). It is **NOT a sale return** (goods shipped + sold, then physically returned → a Tally **Credit Note** against the invoice, a separate returns flow with its own document). **Do not** process a return by "un-dispatching." And it is **not** a content edit — **admin full-edit** already changes items/prices/retailer on any non-cancelled order; step-back only changes **status** and clears that stage's stamps.

## The machine — backward edges (admin-only), all one button: **"Undo"**
Forward machine today: `backorder → pending_approval → approved → ready_to_bill → billed → dispatched` (plus `→ cancelled` from most live states).

Owner rule: *"every step post `backorder`/`pending_approval` may go back one step"* — **except cancelled, which is final.**

| "Undo" on… | Reverses | Clears | Notes |
|---|---|---|---|
| **approved** (Disapprove) | `approved → pending_approval` | `approved_at` / `approved_by` | clean — nothing scanned yet |
| **ready_to_bill** (Un-pick) | `ready_to_bill → approved` | `order_item_scans` + `picked_qty` + `picked_at` / `picked_by`; handles the split backorder child (below) | side-effecting — see rule |
| **billed** (Un-bill) | `billed → ready_to_bill` | **`tally_bill_no` → NULL** + `processed_at` / `processed_by` | reverses `process_order`; bill-no CHECK allows it (`ready_to_bill` is unrestricted) |
| **dispatched** (Un-dispatch) | `dispatched → billed` | `dispatched_at` / `dispatched_by` + `dispatch_note` | clean |
| **cancelled** | — | — | **NO un-cancel. Cancelled is final** (owner 2026-07-17). |

## Locked decisions (owner, 2026-07-17)
- **Four buttons, all labelled "Undo"** — one label everywhere; the **confirm** names where it lands and any side effect. NO un-cancel.
- **One tap + an "are you sure?" confirm, NO reason field.** *"Doesn't matter what it was"* — the system auto-logs a `stepped_back` event; the admin types nothing.
- **Un-pick (the crux — decided):** the whole pick is presumed wrong, so:
  - **Backorder child still an untouched `backorder`:** auto-**cancel** it (status → `cancelled`) with reason **`Original order (#<parent order_ref>) pushed back to 'Approved' status.`**, then move the original back to `approved`. Both logged.
  - **Backorder child already advanced** (status ≠ `backorder` — punched/approved/etc.): **block** the un-pick → *"Finish or cancel backorder #<child order_ref> first"* (the ref is a tappable link on the FE).
  - **Full pick (no child):** just move the original back to `approved`.
  - Always: delete the original's `order_item_scans`, reset its `picked_qty` to NULL, clear `picked_at/by`. The `recompute_order_total` trigger restores `total_paise` to the full order.
- **Un-bill:** removes the Tally bill number (`tally_bill_no` → NULL) + clears `processed_at/by`. ⚠️ Tally still holds the sales voucher — the app never touches Tally, so the accountant voids/fixes that side by hand.
- **Button styling:** the **universal undo icon (↩)**, and a **red *outlined* button** — red text + red border on a transparent/white background (the **inverse** of the Cancel button, which is white text on solid red). **On press it inverts** to solid red (white text, red fill), mirroring Cancel's resting state. Reuse the app's button tokens (`--color-error`).

## Mechanism (build)
- One RPC — **`step_back_order(p_order_id uuid)`** — `SECURITY DEFINER`, **admin-only** (`auth_profile_role() = 'admin'`, else raise). Reads the current status, computes the single one-step-back target, performs the reversal (clears that stage's stamps), logs a **`stepped_back`** event `{from, to}` (no reason param — auto). The un-pick branch also cancels/blocks on the backorder child per the rule above. **No `p_reason`.**
- **Guard:** `guard_order_transition` gains **four admin-only backward edges** — `approved→pending_approval`, `ready_to_bill→approved`, `billed→ready_to_bill`, `dispatched→billed` — each gated on `auth_profile_role() = 'admin'` (enforced in the guard *and* the RPC, never UI-only). The backorder-child cancel rides the existing `backorder→cancelled` edge.
- **Frontend:** a single **"Undo"** secondary button (red outline, ↩ icon, inverts on press) on the order-detail, **admin-only**, shown on the four eligible statuses; a light **"are you sure?" confirm** (reuse the existing confirm BottomSheet) naming the destination + any side effect (bill-no removal; pick/backorder clearing); on the blocked un-pick, the confirm/inline message carries the backorder link; `router.refresh()` after.

## Guardrails
- **Admin-only**, **one step at a time** (no multi-jump), **no un-cancel**.
- **Not a return** (separate credit-note flow). **Not an edit** (full-edit owns content).
- **Money / immutability:** no step-back rewrites a snapshotted line price. Un-pick restores `total_paise` to the full order via the recompute trigger; un-bill leaves the total unchanged.
- **Tally desync:** un-bill / un-dispatch reverse things Tally already recorded — the admin reconciles Tally by hand.

## Acceptance (reviewer verifies by execution)
- Admin "Undo" on each eligible stage steps it back exactly one step; a **non-admin cannot** (no button + the RPC raises).
- Each Undo **clears exactly its stage's stamps** and logs a `stepped_back` `{from,to}` event; **no reason is required**.
- **Un-bill** sets `tally_bill_no` NULL + clears `processed_at/by`; the `billed`/`dispatched` bill-no CHECK still holds for orders left in those states.
- **Un-pick:** an untouched backorder child is **cancelled** with the standard reason and the original lands in `approved` (serials gone, `picked_qty` NULL, `total_paise` recomputed to full); an **advanced** child **blocks** the un-pick with the backorder link.
- **Cancelled orders show no Undo** (final).
- Money & immutability intact; migration reconciled to the ledger; `tsc` / `eslint` / `build` clean.
