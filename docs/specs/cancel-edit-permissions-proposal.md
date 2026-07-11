# Cancel / Edit permissions + edit-window removal

> **STATUS: IMPLEMENTED on branch `feat/cancel-edit-permissions` (2026-07-11)** —
> migration `20260711153000_cancel_edit_permissions.sql` (guard_order_transition
> + cancel_order + update_order_items) and the frontend gating. Verified by
> execution: 15/15 role×state probes pass in a rolled-back txn.
>
> **⚠️ NOT yet applied to prod / not yet deployed.** The migration file is
> committed but has **not** been run against the live DB — that apply is a gated
> step done at merge/deploy time on the owner's go-ahead (so the prod DB never
> diverges from the prod frontend). Fully reversible: `CREATE OR REPLACE` the
> prior function bodies; no column dropped, no data mutated, no constraint change.

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
**a salesman may edit while the order is `pending_approval`, i.e. any time
before an admin approves it.** Once approved, he's locked out exactly as today.
(A `backorder` is **not** salesman- or accountant-editable — admin-only, per the
edit matrix below.) Rationale: the 2h window predates the universal admin-approval
lifecycle; now an order simply waits in `pending_approval` until an admin acts,
so "editable = not yet approved" is simpler and more predictable, and the
"editable till HH:MM" countdown disappears everywhere.

`editable_until` **column is retained** (still written by `submit_order`) — we
just stop *reading* it. Dropping a NOT NULL column on prod is a destructive
migration for no benefit; can be cleaned up later.

### Surfaces touched by Part 1

**Backend (DB functions — source of truth):**
- `update_order_items` — drop `editable_until > now()`; salesman **and** accountant edit gate becomes `status = 'pending_approval'` only; every post-approval state (`backorder`/`approved`/`ready_to_bill`/`billed`) is **admin-only** (reason-logged) (see Part 3).
- `cancel_order` — salesman gate becomes `status = 'pending_approval'` (drop the timer); accountant may cancel **only** `pending_approval`; every other state is admin-only (see Part 2).
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
| `backorder` | ❌ | ❌ | ✅ + reason |
| `approved` (Pending scan) | ❌ | ❌ | ✅ + reason |
| `ready_to_bill` | ❌ | ❌ | ✅ + reason |
| `billed` | ❌ | ❌ | ✅ + reason |
| `cancelled` | — terminal, no re-cancel — | — | — |

**In one line:** salesman cancels only his own `pending_approval`; **accountant cancels only `pending_approval`**; **admin cancels any state.**

**Deltas vs today:**
- **New:** `backorder → cancelled` allowed (admin) — fixes the bug the owner hit: "illegal order status transition: backorder -> cancelled".
- **New restriction:** the **accountant can now cancel ONLY `pending_approval`** (today accountant can cancel every non-cancelled state). Everything past that — `backorder`, `approved`, `ready_to_bill`, `billed` — is **admin-only**. Requires splitting the accountant vs admin branch in `cancel_order`.

## Part 3 — EDIT permissions (FINAL, approved by owner)

Edit is treated as **more** dangerous than cancel past the pick — line changes
desync `picked_qty` / the Tally invoice — so it locks earlier, with only an
admin "break-glass" on the expensive-to-redo late states.

| Order state | Salesman (own) | Accountant | Admin |
|---|---|---|---|
| `pending_approval` | ✅ (no reason) | ✅ (no reason) | ✅ (no reason) |
| `backorder` | ❌ | ❌ | ✅ + reason **(admin only)** |
| `approved` (Pending scan) | ❌ | ❌ | ✅ + reason **(admin only)** |
| `ready_to_bill` | ❌ | ❌ | ✅ + reason **(admin only)** |
| `billed` | ❌ | ❌ | ✅ + reason **(admin only)** |
| `cancelled` | — terminal — | — | — |

**In one line:** salesman & accountant edit **only** `pending_approval`; **admin** additionally edits every post-approval state — `backorder`, `approved`, `ready_to_bill`, `billed` — each reason-logged.

**Rationale for the shape:** past `pending_approval`, only an **admin** may edit,
and every such edit is reason-logged (`edited_after_lock`). Salesman & accountant
are limited to the pre-approval `pending_approval` stage. Clean rule: *non-admins
edit only before approval; admin can edit any live (non-cancelled) order.*

**Deltas vs today:**
- **Window removed** (Part 1): salesman edits any `pending_approval` order, not just in-window.
- **New restriction:** a `backorder` is now **admin-only** to edit (was salesman-owner + accountant).
- **New restriction:** `approved`/`ready_to_bill`/`billed` edits are **admin-only** (today accountant+admin).
- Net: **accountant edits only `pending_approval`** now (mirrors its cancel rights); **admin edits any non-cancelled order** (with a reason once past `pending_approval`).

> **Note:** with `backorder` no longer salesman-editable, a salesman's only
> backorder action is **Punch** (→ pending_approval); quantity fixes route
> through an admin.

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
   - `cancel_order` — drop timer; accountant may cancel **only** `pending_approval`; every other state is admin-only.
   - `update_order_items` — drop timer; salesman **and** accountant edit only `pending_approval`; every post-approval state (`backorder`/`approved`/`ready_to_bill`/`billed`) is admin-only (reason).
2. **Frontend** — Part 1 surfaces (remove window + countdown), and align the cancel/edit **button visibility** with the two matrices per role/state.
3. Regenerate `database.types.ts` only if signatures change (they won't — bodies only).
4. Manual verify via rolled-back RPC probes per matrix cell (each role × state).

## Reversibility

Fully reversible: functions via `CREATE OR REPLACE` (restore prior bodies),
frontend via git, `editable_until` column retained. No destructive step.
