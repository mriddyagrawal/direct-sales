# Cancel / Edit permissions + edit-window removal — PROPOSAL

> **STATUS: PROPOSED — NOT IMPLEMENTED. Do not build from this yet.**
> Drafted 2026-07-11 with the owner (Mridul). Owner is reviewing the *behaviour*
> with his dad before anything ships. This file records the agreed matrices and
> the full change surface so implementation is a rubber-stamp once approved.
>
> Everything here is **easily reversible** — the three DB changes are
> `CREATE OR REPLACE FUNCTION` (current definitions are preserved in git history
> / this repo's migrations), no column is dropped, no data is mutated, no
> constraint changes. Frontend is git-reversible.

## Context

The app + Supabase DB are **live prod** (owner, 2026-07-11). No change lands
without owner approval. This proposal has three parts:

1. Remove the 2-hour salesman edit window (gate edits on *status*, not a timer).
2. A finalised **cancel** permissions matrix.
3. A finalised **edit** permissions matrix.

---

## Part 1 — Remove the 2h edit window

**Today:** a salesman may edit/cancel his order only while
`status = 'pending_approval' AND editable_until > now()` (a 2h timer set at
submit). After that he's read-only ("ask an accountant").

**Proposed:** drop the timer entirely. Editability is purely status-driven:
**a salesman may edit while the order is `pending_approval` (or `backorder`),
i.e. any time before an admin approves it.** Once approved, he's locked out
exactly as today. Rationale: the 2h window predates the universal admin-approval
lifecycle; now an order simply waits in `pending_approval` until an admin acts,
so "editable = not yet approved" is simpler and more predictable, and the
"editable till HH:MM" countdown disappears everywhere.

`editable_until` **column is retained** (still written by `submit_order`) — we
just stop *reading* it. Dropping a NOT NULL column on prod is a destructive
migration for no benefit; can be cleaned up later.

### Surfaces touched by Part 1

**Backend (DB functions — source of truth):**
- `update_order_items` — `v_editable` becomes `status IN ('pending_approval','backorder')` (drop `editable_until > now()`).
- `cancel_order` — salesman gate becomes `status = 'pending_approval'` (drop the timer).
- `submit_order` — unchanged (still sets `editable_until`; now cosmetic/unused).

**Frontend (incl. removing every "editable till xx:xx"):**
- `src/components/orders/OrderDetailView.tsx` — `editable` drops the time check (drives cancel/edit buttons + reason prompt); remove the "editable until HH:MM" byline.
- `src/lib/order-status.ts` — remove the "editable 1h 59m" sublabel on the amber *Pending approval* chip.
- `src/app/new-order/Confirmation.tsx` — the post-submit countdown → reword to "editable until it's approved" (or drop).
- `src/app/new-order/page.tsx` — resume-draft gate drops the time check.
- `src/lib/format.ts` — `formatCountdown` becomes dead → delete.
- List/detail SELECTs still fetch `editable_until` — harmless, left in place; trim in a later cleanup.

---

## Part 2 — CANCEL permissions (FINAL, approved by owner)

Salesman acts only on **his own** order. Staff cancels always require a **reason**.

| Order state | Salesman (own) | Accountant | Admin |
|---|---|---|---|
| `pending_approval` | ✅ (no reason) | ✅ + reason | ✅ + reason |
| `backorder` | ❌ (may *edit*, not cancel) | ✅ + reason | ✅ + reason |
| `approved` (Pending scan) | ❌ | ✅ + reason | ✅ + reason |
| `ready_to_bill` | ❌ | ✅ + reason | ✅ + reason |
| `billed` | ❌ | ❌ | ✅ + reason **(admin only)** |
| `cancelled` | — terminal, no re-cancel — | — | — |

**Deltas vs today:**
- **New:** `backorder → cancelled` allowed for accountant/admin (this is the bug the owner hit: "illegal order status transition: backorder -> cancelled").
- **New restriction:** cancelling a `billed` order is **admin-only** (today accountant+admin). Reason: it reverses a Tally invoice. Requires splitting the accountant/admin branch in `cancel_order`.

## Part 3 — EDIT permissions (FINAL, approved by owner)

Edit is treated as **more** dangerous than cancel past the pick — line changes
desync `picked_qty` / the Tally invoice — so it locks earlier, with only an
admin "break-glass" on the expensive-to-redo late states.

| Order state | Salesman (own) | Accountant | Admin |
|---|---|---|---|
| `pending_approval` | ✅ (no reason) | ✅ (no reason) | ✅ (no reason) |
| `backorder` | ✅ own (no reason) | ✅ + reason | ✅ + reason |
| `approved` (Pending scan) | ❌ | ❌ | ❌ — **locked, cancel + redo** |
| `ready_to_bill` | ❌ | ❌ | ✅ + reason **(admin only)** |
| `billed` | ❌ | ❌ | ✅ + reason **(admin only)** |
| `cancelled` | — terminal — | — | — |

**Rationale for the shape:** `approved` is cheap to redo (not yet picked) → just
lock it and cancel+redo. `ready_to_bill`/`billed` are expensive to redo
(re-pick, re-invoice) → keep an **admin-only, reason-logged** override
(`edited_after_lock`).

**Deltas vs today:**
- **Window removed** (Part 1): salesman edits any `pending_approval` order, not just in-window.
- **New restriction:** `approved` is now **fully locked** (today accountant/admin can edit it with a reason).
- **New restriction:** `ready_to_bill`/`billed` edits are **admin-only** (today accountant+admin).

> ⚠️ **Open point for the owner/dad discussion:** the edit matrix locks
> `approved` for *everyone* yet allows admin to edit the *later* `ready_to_bill`
> and `billed`. That's intentional (cheap-to-redo vs expensive-to-redo), but it
> is slightly non-monotonic — worth a sanity check when you discuss.

---

## Reverse-cancel (un-cancel) — does NOT exist today

There is **no** way to un-cancel an order. `cancelled` is terminal in
`guard_order_transition` (no `cancelled → *` clause) and `cancel_order` rejects
an already-cancelled order. No button, no RPC. If ever wanted, it's net-new work
with its own permission row — **not in scope here.**

---

## Implementation checklist (once approved — DB change, needs explicit go-ahead)

1. **One migration** recreating three functions:
   - `guard_order_transition` — add `backorder → cancelled`.
   - `cancel_order` — drop timer from salesman gate; split accountant vs admin so `billed → cancelled` is admin-only.
   - `update_order_items` — drop timer; lock `approved`; make `ready_to_bill`/`billed` edits admin-only (reason).
2. **Frontend** — Part 1 surfaces (remove window + countdown), and align the cancel/edit **button visibility** with the two matrices per role/state.
3. Regenerate `database.types.ts` only if signatures change (they won't — bodies only).
4. Manual verify via rolled-back RPC probes per matrix cell (each role × state).

## Reversibility

Fully reversible: functions via `CREATE OR REPLACE` (restore prior bodies),
frontend via git, `editable_until` column retained. No destructive step.
