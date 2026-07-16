# Admin step-back — "go back a step" (spec)

**Status:** design captured 2026-07-16. Some decisions locked (owner); **two open** — flagged below. **Not built.** Relates to [order-lifecycle.md](order-lifecycle.md), [roles-and-permissions.md](roles-and-permissions.md), and the cancel/edit matrices.

## Goal
Let the **admin** walk an order **one step backward** through the lifecycle to **correct a mistake** — an order approved too early, billed with the wrong number, dispatched before it should have been, or cancelled by accident. Admin-only, reason-logged, one step at a time.

## What this is NOT — the key distinction
Step-back is for **fixing mistakes** (an order that shouldn't have advanced). It is **NOT a sale return.** A return is a real business event — goods shipped + sold, then physically came back — which in accounting is a **Tally Credit Note against the original invoice**, handled by a **separate returns flow** (own document, per-line qty + serials). **Do not** process a return by "un-dispatching": you'd lose the return record and desync Tally. Keep the two features apart.

## The machine — backward edges (admin-only)
Forward machine today: `backorder → pending_approval → approved → ready_to_bill → billed → dispatched` (plus `→ cancelled` from most live states).

Owner rule: **"every step *post* `backorder`/`pending_approval` may go back one step."** So step-back adds one reverse edge per stage:

| Go-back | Reverses | Clears | Difficulty | Decision |
|---|---|---|---|---|
| **Disapprove** | `approved → pending_approval` | `approved_at` / `approved_by` | 🟢 clean — nothing scanned yet | assumed fine (confirm) |
| **Un-pick** | `ready_to_bill → approved` | serials + `picked_qty` + the split backorder child + `picked_at/by` | 🔴 side-effecting | **OPEN — no decision** |
| **Un-bill** | `billed → ready_to_bill` | **`tally_bill_no`** + `processed_at` / `processed_by` | 🟡 Tally already has the voucher | ✅ **DECIDED** |
| **Un-dispatch** | `dispatched → billed` | `dispatched_at/by` + `dispatch_note` | 🟢 clean | assumed fine (confirm) |
| **Un-cancel** | `cancelled → (prior state)` | `cancelled_at` / `cancelled_by` | 🔴 prior state not stored | **OPEN — no decision** |

## Locked decisions (owner, 2026-07-16)
- **Un-bill** (`billed → ready_to_bill`): **allowed.** It **removes the Tally bill number** (`tally_bill_no` → NULL) and clears `processed_at/by`. Purpose: **correcting** a billing entry.
  - ⚠️ **Real-world caveat:** Tally already holds the sales voucher — the app doesn't touch Tally, so the accountant must void/fix that side manually. The bill-no CHECK still holds for any order left in `billed`/`dispatched`.

## Open — need an owner decision before build
1. **Un-pick** (`ready_to_bill → approved`) — the pick had side effects; going back must decide each:
   - **Serials (LG):** delete the captured `order_item_scans` so units can be re-picked? (Expected: **yes**.)
   - **`picked_qty`:** reset to NULL / un-picked? (Expected: **yes** — mirrors the zero-pick reset; the recompute trigger restores `total_paise` to the full order.)
   - **The backorder child (the crux):** a *partial* pick split off a `backorder` child for the remainder. On un-pick, does that child get **deleted** (this pick created it), **left as-is**, or **cancelled**? Deleting is clean only if the child hasn't already been **punched / acted on** — decide the rule (e.g. "delete only if still an untouched `backorder`, else block the un-pick with a message").
2. **Un-cancel** (`cancelled → ?`) — the machine doesn't store the pre-cancel status:
   - **Target status:** read the **last non-cancelled status** from `order_events` history and land there? Or always un-cancel to a **fixed** state (e.g. `pending_approval`)? Note who cancelled it — a salesman self-cancel (D8) vs an office cancel may want different targets.
   - **Data:** the pre-cancel items/prices are intact (cancel doesn't touch them), so **restoring is safe** — only the *target status* is the open question.

## Mechanism (when built)
- One RPC — e.g. `step_back_order(p_order_id uuid, p_reason text)` — `SECURITY DEFINER`, **admin-only**; reads the current status, computes the one-step-back target, performs the reversal (clears that stage's stamps), **requires a reason**, logs a `stepped_back` event (`{from, to, reason}`). New **admin-only guard edges** in `guard_order_transition` for each backward transition (role enforced there + in the RPC, not just the UI).
- **Reason required** on every step-back — the audit trail for "why did this order move backward" (same discipline as the after-lock edit reason).
- **Frontend:** a "Go back a step" secondary on the order detail, admin-only, on the eligible statuses; a light confirm + reason field; `router.refresh()`.

## Guardrails
- **Admin-only**, reason-logged, **one step at a time** (no multi-jump).
- **Not a return** — returns are a separate credit-note flow.
- **Money / immutability:** no step-back rewrites a snapshotted line price. Un-pick restores the shipped `total_paise` to the full order (recompute); un-bill leaves the total unchanged.
- **Tally desync:** un-bill (and un-dispatch, once the goods "un-ship") reverse things Tally already recorded — the admin reconciles Tally by hand.

## Acceptance (reviewer verifies by execution once the two open decisions land)
- Admin steps each eligible stage back exactly one step; a **non-admin cannot** (no button + the RPC raises).
- Each step-back **clears exactly its stage's stamps** and logs a **reason'd** `stepped_back` event.
- **Un-bill removes the Tally bill no.**; the `billed`/`dispatched` bill-no CHECK still holds for orders left in those states.
- **Un-pick** behaves per the decided serial / `picked_qty` / backorder-child rules.
- **Un-cancel** lands per the decided target status.
- Money & immutability intact; migration reconciled; `tsc` / `eslint` / `build` clean.
