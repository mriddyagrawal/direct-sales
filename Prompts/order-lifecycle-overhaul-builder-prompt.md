# Builder prompt — Order lifecycle overhaul: universal approval · no `submitted` · `processed`→`billed` · `requires_scan`

A foundational change to the order state machine. Read [docs/specs/order-lifecycle.md](../docs/specs/order-lifecycle.md) and [docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md) for context, and **update both** to match at the end.

## The new lifecycle
```
salesman submits ANY order → pending_approval        (all brands — not just LG)
        │
   admin approves  (admin-only, every brand)
        ├── brand.requires_scan = true  (LG)     → approved → [godown QR scan] → ready_to_bill
        └── brand.requires_scan = false (fixed)  → ready_to_bill  (straight, no scan)
        │
   accountant/admin bills:  ready_to_bill → billed
                            approved → billed  (kept: LG override, bill without the godown step)
cancel (reason) allowed from pending_approval / approved / ready_to_bill / billed
```
- **`submitted` status is removed entirely.** Every order starts in `pending_approval`.
- **`processed` status is renamed to `billed`** (value, event, and chip vocabulary — see the rename scope below).
- **`brands.requires_approval` is renamed to `brands.requires_scan`** (values unchanged: LG=true, fixed=false). Approval is now universal, so that flag's only remaining job is "needs the godown scan step." This decouples **price** (`pricing_mode`) from **scan** (`requires_scan`) — a future manual-priced brand with no barcodes is then just a brand row (`pricing_mode='manual'`, `requires_scan=false`), no code change.

## Rename scope for `processed` → `billed` (be precise)
- **Rename** (the status vocabulary): the status **value** `'processed'`→`'billed'`, the `order_events` **action** `'processed'`→`'billed'`, and the `StatusTone` token `'processed'`→`'billed'` (the green chip tone in `StatusTag.tsx` + `order-status.ts`).
- **Keep as internal plumbing** (don't rename — they never surface as "processed" to anyone): the columns `orders.processed_at` / `processed_by`, and the `process_order` RPC + its `processOrder` wrapper. The byline already reads those columns and displays "billed".

## 1. Database — one migration (14-digit filename, no `T`; apply via MCP; reconcile the repo filename to the ledger version)
- **`brands`**: `alter table brands rename column requires_approval to requires_scan;`
- **`submit_order`**: set `v_status := 'pending_approval'` always (drop the `case when v_requires_approval …` and the now-unused var). Everything else identical.
- **`approve_order`** (admin-only — unchanged role check): after asserting `status = 'pending_approval'`, read the order's `brand.requires_scan`; set status to **`'approved'` when true**, **`'ready_to_bill'` when false**. Stamp `approved_at/by` and log the `approved` event in **both** cases.
- **`guard_order_transition`**: remove all `submitted` edges. `→ approved`: from `pending_approval`, admin (unchanged). **`→ ready_to_bill`: allow from `approved` (godown) OR from `pending_approval` (admin)** — the fixed-brand approval path. Keep `pending_approval→cancelled`, `approved→{billed,cancelled}`, `ready_to_bill→{billed,cancelled}`, `billed→cancelled`. (All `processed` → `billed` here.)
- **`process_order`**: processable set `('submitted','approved','ready_to_bill')` → **`('approved','ready_to_bill')`**; it now sets `status='billed'` and logs event action `'billed'`. (Keep the `pending_approval → "must be approved first"` guard; keep the function name.)
- **`update_order_items`**: editable window check `status in ('submitted','pending_approval')` → `status = 'pending_approval'`.
- **`cancel_order`**: drop `'submitted'` from its cancellable-from set. (Leave its serial-scan handling exactly as-is — a separate prompt covers that.)
- **`submit_pick`**: `b.requires_approval` → `b.requires_scan`.
- **Godown RLS** — `orders_select_godown`, `order_items_select_godown`, `order_item_scans_select_godown`: `requires_approval` → `requires_scan` (godown stays scoped to scan brands; fixed `ready_to_bill` orders remain invisible to godown ✓).
- **`orders.status` CHECK**: new allowed set `('pending_approval','approved','ready_to_bill','billed','cancelled')`.
- **Backfill** (mind the ordering + the guard trigger): there are **no `submitted` orders**, but **3 `processed` orders + their events** must become `billed`. A raw `update orders set status='billed' where status='processed'` will trip `guard_order_transition` and the CHECK, so: **drop the old CHECK → disable the guard trigger (or `set session_replication_role='replica'`) → `update orders set status='billed' where status='processed'` and `update order_events set action='billed' where action='processed'` → re-enable the trigger → add the new CHECK.**
- **Regenerate** `src/lib/types/database.types.ts` (the `requires_scan` rename + the status set).

## 2. Frontend — one commit
- **`src/components/ui/StatusTag.tsx`**: rename the `StatusTone` value `'processed'` → `'billed'` (keep the same green styling).
- **`src/lib/order-status.ts`** (`getOrderStatusTag`): remove the `submitted` branches (the `pending_approval` case already carries the countdown); `status === 'processed'` → `'billed'` with `tone: 'billed'`, label **"Billed"**. Keep `approved` → label **"Approved"** (chip stays short).
- **`src/app/dashboard/OrdersList.tsx`**: `StatusFilter` — remove `'submitted'`, **add `'approved'`**, `'processed'`→`'billed'`. `STATUS_LABEL`: `approved: "Approved/Waiting for Scan"`, `billed: "Billed"` (no `submitted`). Update `tabCounts` and the tab array → **All / Pending approval / Approved/Waiting for Scan / Ready to bill / Billed / Cancelled**.
- **`src/app/orders/[id]/page.tsx`** (salesman): `editable` = `status === 'pending_approval'` within window only; drop the `submitted`-locked note branch; `'processed'` → `'billed'` in the note conditions; make the **`ready_to_bill` note generic** (fixed brands aren't "picked") — e.g. "Approved — the office will bill it shortly."
- **`src/app/dashboard/orders/[id]/OrderWorkbench.tsx`**: `editable` = `pending_approval` only; **Mark billed** shows for `approved`/`ready_to_bill` (not `submitted`); `'processed'`→`'billed'` in the byline + `showSerials`; the **Approve** button (admin-only) shows for `pending_approval` — which is now every brand.
- **`src/app/new-order/page.tsx`**: edit-eligibility `row.status === 'submitted'` → `'pending_approval'`.
- **`src/lib/order-events.ts`**: **keep** the `submitted` case (that event is the salesman *placing* the order — still fires, still accurate); change the `processed` case → **`billed`** ("Billed by …").

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Universal approval:** a Zebronics order and an LG order both land in `pending_approval` on submit; both show an **Approve** button to the admin, none to the accountant/salesman.
- **Approval routing:** approving a **fixed** order → `ready_to_bill` (no godown, no `approved`); approving an **LG** order → `approved`, then godown `submit_pick` → `ready_to_bill`.
- **Billing:** `ready_to_bill → billed` via Mark billed; `approved → billed` override still works for LG.
- **No `submitted`:** the status is gone from the CHECK, the guard, all RPCs, the dashboard tabs, and the frontend; existing data has none.
- **`billed` everywhere:** status value, `order_events.action`, and the chip all read `billed`; the 3 previously-`processed` orders + their history now show **Billed**; internal `processed_at/by` + `process_order` untouched.
- **Dashboard tabs:** All / Pending approval / **Approved/Waiting for Scan** / Ready to bill / Billed / Cancelled, with correct counts; the Approved tab lists LG orders awaiting the godown.
- **Editing:** a `pending_approval` order is salesman-editable within the 2h window; after approval it's read-only.
- **Godown unchanged** apart from the flag rename (still LG-only, approved→ready_to_bill, coverage, etc.).
- `npm run build` + `tsc` + eslint clean; types regenerated.

## Guardrails
- **Admin-only approval** (owner decision) — do NOT let accountant/salesman approve.
- Rename the **status vocabulary** (value/event/tone) to `billed`; **do NOT** rename `processed_at`/`processed_by` or `process_order` (plumbing, invisible).
- `requires_scan` rename is DB + generated-types only (no app code reads the old name — verified).
- Don't touch money/pricing, the serial/scan mechanics, the 2h window, or role gates beyond what's listed.
- Backfill must not leave any `processed`/`submitted` behind, and must not trip the guard or CHECK mid-migration.
- Update `docs/specs/order-lifecycle.md` + `docs/godown-fulfilment-design.md` to the new model.
