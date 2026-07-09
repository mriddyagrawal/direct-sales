# Builder prompt — Serials: within-bill unique only (drop cross-bill uniqueness)

Change LG serial-scan uniqueness from **global** (a serial can exist once in the whole system) to **within-bill only** (a serial can't be scanned twice on the *same* order, but the *same physical unit can appear on different bills over time*). Reason: returns / cancellations / re-sales happen in the real world and the owner can't feed all that back to the app yet — the global unique was blocking legitimate re-scans. Design context: [docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md).

**Keep both within-bill guards intact** (owner explicitly wants these):
- **Instant client reject** on the pick screen when a serial is already on the order being picked (`PickScreen`'s `allSerials` set + the 2.5s same-barcode debounce) — **do not touch this**, it's client-side and independent of the DB.
- **Backend reject** of a serial scanned twice in one submission — this currently rides on the DB unique index; when that index is dropped, replace it with an explicit within-batch check in `submit_pick` (below).

## 1. Migration — drop the global unique + free cancelled scans
Standard **14-digit filename, no `T`** (per the ㉝ reconciliation); apply via MCP, reconcile the repo filename to the ledger version.
- `drop index if exists public.order_item_scans_serial_uq;` — this is the entire "can't reuse a serial across bills" behavior. (Keep the table, the PK, and the `serial`/`raw_scan` columns.)
- **`cancel_order`**: it currently **deletes** the order's `order_item_scans` — that delete only existed to free serials for the global unique. Remove that delete so a cancelled bill **keeps its scan record** (better audit; no longer needed for re-use since uniqueness is gone). Leave the rest of `cancel_order` unchanged.

## 2. `submit_pick` — replace the cross-order rejection with a within-bill one
The current RPC inserts scans row-at-a-time and catches `unique_violation` → *"serial % already recorded on another order"*. With the index dropped that catch is dead, and cross-order is now allowed. Instead:
- **Before inserting**, derive the cleaned serial for every scan in `p_scans` (same rule: `coalesce(substring(raw from '[0-9]{3}[A-Z]{4}[0-9]{6}'), btrim(raw))`) and **reject if any cleaned serial appears more than once in this submission** — name the offender, e.g. `raise exception 'serial % was scanned twice on this bill', v_dup;`. This is the within-bill backend guard.
- Then insert all scans normally (no `unique_violation` handling needed anymore — a serial that exists on another order must now insert fine).
- **Everything else stays**: godown-only gate, `approved` + `requires_approval` (LG) check, `FOR UPDATE` lock, full-coverage check (scan count == qty per line), server-side serial extraction stored in `serial` + raw in `raw_scan`, `picked_at/by` stamp, `approved → ready_to_bill` transition, `picked` event.

## 3. No client change required
`PickScreen`'s instant within-order reject and the 2.5s debounce are client-side JS (a `Set` of the order's serials) and stay exactly as-is — verify they still work. No UI copy change needed (the "already scanned on this order" message is still accurate).

## 4. Docs
Update [docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md): the `order_item_scans` section now says **within-bill unique only** (no global unique index); a serial may recur across orders (returns/cancellations); cancel keeps scans. Remove the old "global unique excl. cancelled" / "cancel frees serials" notes.

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Cross-bill now allowed:** submit_pick a serial on order A (→ ready_to_bill), then submit the **same serial** on a *different* LG order B → **succeeds** (no rejection).
- **Within-bill still blocked, both layers:** on the pick screen, scanning a serial already on the current order → **instant** client reject; and a crafted `submit_pick` payload containing the same serial twice → **backend rejects** by name.
- **Coverage + gates unchanged:** godown-only, approved+LG-only, exact per-line coverage still enforced; cross-order reuse doesn't bypass any of them.
- **Cancel keeps scans:** cancelling a picked order no longer deletes its `order_item_scans`.
- `npm run build` + `tsc` + eslint clean. Migration filename reconciled to the ledger version.

## Guardrails
- Godown/backend only. **No RLS/role changes, no new columns.** Just drop one index + tweak two RPCs (`submit_pick`, `cancel_order`).
- Don't weaken within-bill uniqueness (client instant reject + backend batch check must both remain) or any other godown guard (role, status, brand, coverage).
- Money/prices untouched; this is serials only.
