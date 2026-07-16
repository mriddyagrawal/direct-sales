# Builder prompt — Admin "Undo" (step-back one stage)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-17** · grounded against the live prod schema + RPC bodies (`ugjwcbxyyuowiyhczcrh`). Full design: [docs/specs/admin-step-back.md](../docs/specs/admin-step-back.md).

## Goal, one line
Give the **admin** one **"Undo"** button that walks an order **one stage backward** to fix a mistake — approved too early, billed with the wrong number, dispatched too soon, or a bad pick. Admin-only, one tap + an "are you sure?" confirm, **no reason typed**, every step audited. **Not** a sale return; **not** a content edit (admin full-edit already owns items/prices/retailer).

All decisions are **LOCKED** (see the spec) — don't re-open. Build in **2 commits**: (1) DB, (2) FE.

## The four backward edges (all one button, "Undo"); cancelled is FINAL — no un-cancel

| "Undo" on… | → target | Clear |
|---|---|---|
| `approved` (Disapprove) | `pending_approval` | `approved_at`, `approved_by` |
| `ready_to_bill` (Un-pick) | `approved` | `order_item_scans` for the order's items, `picked_qty`→NULL, `picked_at`, `picked_by` (+ backorder-child rule below) |
| `billed` (Un-bill) | `ready_to_bill` | `tally_bill_no`→NULL, `processed_at`, `processed_by` |
| `dispatched` (Un-dispatch) | `billed` | `dispatched_at`, `dispatched_by`, `dispatch_note` |

## Current state (verified — build against this)

- **Statuses:** `backorder → pending_approval → approved → ready_to_bill → billed → dispatched` (+ `→ cancelled`). `orders` has all the stamps: `approved_at/by`, `picked_at/by`, `dispatched_at/by`, `dispatch_note`, `processed_at/by`, `tally_bill_no`, `cancelled_at/by`, `parent_order_id`, `total_paise`.
- **Billing = `process_order(p_order_id, p_bill_no)`** — sets `status='billed', processed_at, processed_by, tally_bill_no`, logs a `billed` event. **Un-bill reverses exactly this.**
- **Bill-no CHECK** on `orders`: `status NOT IN ('billed','dispatched') OR (tally_bill_no IS NOT NULL AND btrim<>'')`. So Un-bill (→`ready_to_bill`, bill_no NULL) is **fine** — but the status + `tally_bill_no` NULL must be set in the **same UPDATE**.
- **`cancel_order(p_order_id, p_reason)`** — sets `status='cancelled', cancelled_at, cancelled_by`, logs a `cancelled` event `{reason}`. The un-pick backorder-child cancel mirrors this (do it inline in the RPC; don't call `cancel_order` — it has role/reason gates meant for user calls).
- **`submit_pick`** — on a partial pick, sets `picked_qty` per line, moves the order to `ready_to_bill`, and creates a **child order** with `parent_order_id = <this order>`, `status='backorder'`, the shortfall lines. Logs `backordered` events. A full pick creates **no** child. A zero pick sends the order itself back to `backorder` (no child).
- **`guard_order_transition`** trigger enforces every status edge server-side (forward only today). `auth_profile_role()` returns the caller's role; `'admin'` is the gate. `order_events(order_id, actor_id, action, details jsonb)` is the audit log. `recompute_order_total` trigger keeps `total_paise` from the order's lines.
- **Prod caution:** app + DB are LIVE. Branch off `main`. The migration is a **DB change — get owner approval before applying** (they're expecting it; still confirm). Everything is reason-free by design.

---

## Commit 1 — DB: `step_back_order` + four admin-only guard edges  ⚠️ owner-approval-gated

Migration `YYYYMMDDHHMMSS_admin_step_back.sql` (apply via MCP `apply_migration`, then reconcile the filename to the ledger).

**A. `guard_order_transition`** — add four **admin-only** backward edges to the existing function (keep every current forward edge intact; re-create the whole function from its current body + these). Each:
```
if old.status = 'approved'      and new.status = 'pending_approval' then
  if public.auth_profile_role() = 'admin' then return new; end if;
  raise exception 'only admin may step an order back (order %)', old.id;
end if;
-- same shape for: ready_to_bill→approved, billed→ready_to_bill, dispatched→billed
```
(The backorder-child cancel uses the **existing** `backorder→cancelled` edge — no new edge needed.)

**B. `step_back_order(p_order_id uuid) returns orders`** — `SECURITY DEFINER`, `set search_path = public, pg_temp`. **No `p_reason`.**
- Guard: `v_role := auth_profile_role()`; null → raise; `v_role <> 'admin'` → `raise 'only admin may undo a step'`.
- Load the order `for update`; not found → raise.
- Branch on `v_order.status` → compute target + clear stamps + set `v_to`:
  - `approved` → `pending_approval`; clear `approved_at/by`.
  - `billed` → `ready_to_bill`; clear `tally_bill_no, processed_at, processed_by` **in the same UPDATE** as the status.
  - `dispatched` → `billed`; clear `dispatched_at, dispatched_by, dispatch_note`.
  - `ready_to_bill` → `approved` (**un-pick**, below).
  - anything else (incl. `cancelled`, `pending_approval`, `backorder`) → `raise 'order % cannot be stepped back from status %'`.
- **Un-pick branch (`ready_to_bill`):**
  1. Find the active backorder child: `select * from orders where parent_order_id = p_order_id and status <> 'cancelled' limit 1`.
     - If found and `status = 'backorder'` → **cancel it inline**: `update orders set status='cancelled', cancelled_at=now(), cancelled_by=v_caller where id=<child>`; insert an `order_events` `cancelled` row on the child with `details = jsonb_build_object('reason', 'Original order (#'||v_order.order_ref||') pushed back to ''Approved'' status.')`.
     - If found and `status <> 'backorder'` (advanced) → **raise** with a message the FE can turn into a link, e.g. `raise exception 'blocked: finish or cancel backorder % first' , <child order_ref>` (or return a structured error — see FE note). Nothing is changed.
     - If none (full pick) → nothing to do here.
  2. `delete from order_item_scans where order_item_id in (select id from order_items where order_id = p_order_id)`.
  3. `update order_items set picked_qty = NULL where order_id = p_order_id`.
  4. `update orders set status='approved', picked_at=NULL, picked_by=NULL where id = p_order_id`. **Verify `total_paise` reflects the full ordered lines** in the `approved` state (it must equal the sum of the order's `line_total_paise`; if the pick reduced it, restore it). The reviewer checks this by execution.
- After the reversal (all non-blocked branches): insert one `order_events` row on the order: `action='stepped_back'`, `details = jsonb_build_object('from', v_order.status, 'to', v_to)`.
- Return the updated order.
- `grant execute on function public.step_back_order(uuid) to authenticated;` (role re-checked inside).

**Acceptance (reviewer verifies live, rolled back):** admin Undo on each of the 4 stages lands one step back and clears exactly that stage's stamps; a non-admin (accountant/salesman) → raises; `cancelled`/`pending_approval`/`backorder`/`ready_to_bill`-with-advanced-child behave per spec; un-pick cancels an untouched child with the exact reason string and restores `total_paise` to the full order; un-bill leaves the bill-no CHECK satisfied for orders still in `billed`. Commit: `feat(db): step_back_order (admin Undo) + 4 backward guard edges`.

---

## Commit 2 — FE: the "Undo" button

- **`OrderDetailView.tsx`** (the single detail component, all roles): add a **`canUndo`** gate = `isAdmin && order.status ∈ {approved, ready_to_bill, billed, dispatched}`. Render a secondary **"Undo"** button (↩ icon) beside the existing admin actions.
- **Styling — mirror of Cancel:** Cancel is white text on solid `--color-error`. **Undo is the inverse — red text + a 1px `--color-error` border on a transparent/white background — and it inverts to solid red (white text, red fill) on `:active`/press.** Add a button variant or a scoped class; reuse the error token; keep it dark-mode safe.
- **Confirm (reuse the existing confirm BottomSheet):** one tap opens an "are you sure?" sheet, **no text field**. The body names the destination + side effect, per status:
  - approved → "Send this order back to **Pending approval**?"
  - ready_to_bill → "Send back to **Approved**? The pick will be cleared." (if a backorder child exists, mention it will be cancelled)
  - billed → "Send back to **Ready to bill**? This **removes the Tally bill number**." 
  - dispatched → "Send back to **Billed**?"
  - Confirm button calls `stepBackOrder(order.id)`; Cancel closes. `router.refresh()` on success.
- **Blocked un-pick:** when `step_back_order` raises the "finish or cancel backorder …" error, surface it with the **backorder ref as a tappable link** to that order's detail (parse the ref from the error, or — cleaner — have the RPC's un-pick pre-check return a structured `{blocked:true, child_ref, child_id}` you can render; pick whichever is simplest and keep the message exact).
- **RPC wrapper:** add `stepBackOrder(orderId: string)` to `src/lib/order-rpcs.ts` → `rpc('step_back_order', { p_order_id: orderId })`, same `callRpc` wrapper as the others.

**Acceptance:** admin sees **Undo** only on the 4 eligible statuses (never on cancelled/pending/backorder, never for non-admins); one tap → confirm → steps back + refreshes; the confirm text matches the status; the blocked un-pick shows the backorder link. `tsc`/`eslint`/`build` clean. Commit: `feat(orders): admin "Undo" button (step back one stage, red-outline, one-tap confirm)`.

## Guardrails (both commits)
- Branch off `main`; **DB migration only after owner OK**; second commit DB-free.
- Read the newest `comments.md` before each commit; fix any ❌ first.
- Admin-only enforced in the **guard + RPC**, not just the button. No reason field anywhere (auto-logged).
- Don't touch snapshot prices; un-pick restores the full-order `total_paise` via the recompute trigger; un-bill leaves the total unchanged.
- Commit messages literally accurate — the REVIEWER verifies by execution.
