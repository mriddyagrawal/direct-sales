# Builder prompt — Godown fulfilment + LG serial capture

Build the `godown` fulfilment flow: a new **mobile role** that scans each LG unit's serial barcode, which flips the order to **`ready_to_bill`** and hands the accountant structured serials (replacing the WhatsApp-photo step). Full design + rationale: **[docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md)** — read it first; this prompt is the build order, that doc is the source of truth.

## Ground truth you must not get wrong
- **Role helper is `public.auth_profile_role()`** (NOT `current_role` — that was renamed because it collides with a Postgres builtin). Use it in RLS/guards exactly as `guard_order_transition` and the existing policies do.
- **Migrations apply via the Supabase MCP `apply_migration`**, not local CLI. The repo file's name must be the **14-digit `YYYYMMDDHHMMSS_name.sql`, no `T`**, matching the ledger version (the ㉝ reconciliation — a mismatch breaks `db push`). Today is 2026-07-09; latest existing migration is `20260708120241_lg_manual_approval.sql`.
- **Serial format is validated** across 5 categories: `[0-9]{3}[A-Z]{4}[0-9]{6}` (13 chars). Raw scan = `[4-char prefix][serial]IN` (e.g. `W5LN606NWFG207155IN`). LG's serial barcode is a **1D linear barcode**, not a QR.
- **No Tailwind** — CSS Modules + the `src/components/ui/` primitives + tokens in `globals.css`. Money is integer paise; `formatRupees` to display (but the godown never sees money).
- **Camera needs a secure context** — HTTPS (Vercel) or `localhost`, **not plain-http LAN** (same gotcha as `crypto.randomUUID`). Note it in the acceptance test.
- State machine + RPC lens: all order writes go through the RPCs in `src/lib/order-rpcs.ts`; transitions are policed by `guard_order_transition`. Follow that pattern — no direct status writes.

---

## Commit 1 — Backend (migration + RPC), no UI

One migration (or two: schema then functions). Apply via MCP; reconcile the repo filename to the ledger version.

**Schema:**
- `profiles` role check → add `'godown'`: `role in ('admin','accountant','salesman','godown')`.
- `orders.status` check → add `'ready_to_bill'`.
- `alter table orders add column picked_at timestamptz, add column picked_by uuid references profiles(id);`
- New table:
  ```sql
  create table order_item_scans (
    id            uuid primary key default gen_random_uuid(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    raw_scan      text not null,
    serial        text not null,
    scanned_at    timestamptz not null default now(),
    scanned_by    uuid not null references profiles(id)
  );
  create unique index order_item_scans_serial_uq on order_item_scans(serial);
  ```
  **Freeing serials on cancel:** a plain `unique(serial)` + **`cancel_order` deletes the order's scans** so a cancelled unit can be re-sold. Add that delete to the `cancel_order` RPC (delete `order_item_scans` for the order's items before/after the status write). *(Simpler than a cross-table partial index; keep it.)*

**`guard_order_transition` additions** (keep every existing transition intact):
- `approved → ready_to_bill` — allow only when `auth_profile_role() = 'godown'` (mirror how `→ approved` requires admin).
- `ready_to_bill → processed` — allow (accountant/admin path).
- `ready_to_bill → cancelled` — allow.
- **Keep `approved → processed`** (accountant override — do not remove).

**`process_order`** → accept `ready_to_bill` as a valid source status in addition to `submitted`/`approved`.

**New RPC `submit_pick(p_order_id uuid, p_scans jsonb)`** — `security definer`, `set search_path = public, pg_temp`:
1. Assert `auth_profile_role() = 'godown'` (else raise).
2. Load the order; assert it's `status = 'approved'` and its brand `requires_approval` (LG). Else raise.
3. For each element of `p_scans` (`{order_item_id, raw_scan}`): derive the serial server-side —
   `v_serial := coalesce(substring(p_raw from '[0-9]{3}[A-Z]{4}[0-9]{6}'), p_raw);` (regex hit → clean serial; miss → the raw string verbatim, i.e. a manual entry). **Ignore any client-sent serial** — server extraction is authoritative.
4. Validate: every line of the order is **fully covered** (count of scans for each `order_item_id` == that line's `qty`; no extra/unknown line ids). Reject with a clear message otherwise.
5. Insert the `order_item_scans` rows (the `unique(serial)` index raises on a serial already sold elsewhere — catch it and raise `serial % already recorded`).
6. Stamp `picked_at = now(), picked_by = auth.uid()`, set `status = 'ready_to_bill'` (fires the guard → allowed for godown), and insert an `order_events` row `action = 'picked'` (actor = caller). Return the updated order row (same shape the other RPCs return).

**RLS** (mirror the existing `orders_select_*` / `order_items_select_*` naming + `auth_profile_role()` style):
- `orders_select_godown`: `auth_profile_role() = 'godown' AND status in ('approved','ready_to_bill')` and the brand is an approval brand (join/exists on `brands.requires_approval`).
- Matching **select** for `order_items` and `order_item_scans` when the parent order is godown-visible.
- Accountant/admin: extend their existing selects so they also see `ready_to_bill` orders + `order_item_scans` (add scans to their select scope).
- Godown gets **no direct insert** grant — writes go only through `submit_pick` (security definer).

Add a wrapper in `src/lib/order-rpcs.ts`: `submitPick(orderId, scans)` following the existing `callRpc` pattern (same offline/rejection classification). Regenerate `src/lib/types/database.types.ts` via MCP.

---

## Commit 2 — Routing + status surfacing (no godown app yet)

- **Middleware** (`src/lib/supabase/middleware.ts`): add `godown: "/godown"` to `ROLE_HOME`; extend the wrong-territory logic so a `godown` user is confined to `/godown` (redirected off `/` and `/dashboard`), and non-godown users are redirected off `/godown`.
- **`src/lib/order-status.ts`**: add a `ready_to_bill` case → `{ tone: "accent", label: "Ready to bill" }` (pick an existing `StatusTone`; it reads as read-only/pending, distinct from the green `processed`). It behaves like `approved` for the salesman.
- **`src/app/dashboard/OrdersList.tsx`**: add `ready_to_bill` to `StatusFilter`, `STATUS_LABEL` ("Ready to bill"), the tab array, and `tabCounts`. (Realtime already refetches on UPDATE, so a `→ ready_to_bill` transition lands in the tab with no extra wiring.)
- **Salesman order detail** (`src/app/orders/[id]/page.tsx`): add a note for `ready_to_bill` (e.g. "Picked and ready — the office will bill it shortly."), same treatment as the `approved` note.

---

## Commit 3 — The godown app (`/godown`, mobile) + scanner

Add dep **`@zxing/browser`** (framework-agnostic, decodes 1D + QR, works iOS Safari + Android). A native `BarcodeDetector` fast-path is optional; ZXing is the baseline.

- **`/godown`** (server component, gated to `godown` like the other role pages fetch profile.role): the **queue** — approved LG orders awaiting pick. Show **ref · retailer · item count · submitted time**. **No prices** — do not even select price columns in this query. Newest first. Empty state.
- **`/godown/[id]`** (the pick screen, client):
  - Lines = `product_name` + `qty` (**no rate/amount**). Tap a line → it becomes the **active** line.
  - A camera scanner (`@zxing/browser`) decodes the active line's units. On each decode:
    - Extract the serial via a shared helper **`src/lib/serial.ts` → `extractSerial(raw)`** = `{ serial, parsed }` using `/\d{3}[A-Z]{4}\d{6}/` (miss → `{ serial: raw.trim(), parsed: false }`).
    - Reject a within-order duplicate (instant feedback) and reject scanning beyond the line's `qty`.
    - Show progress per line (`2 / 3`); a full line gets a ✓.
    - Unparsed scan (`parsed=false`) → let them **confirm or hand-type** the serial before it counts.
  - **Submit** enables only when **every line is fully scanned**; calls `submitPick(orderId, scans)` where `scans = [{ order_item_id, raw_scan }]` (server derives the serial). Accumulate client-side and submit in **one batch** (warehouse dead-spots shouldn't block picking). On success → route back to the queue; on a server rejection (e.g. duplicate serial across orders) show the offending serial.
  - Camera lifecycle: request on mount of the scan step, **stop tracks on unmount/route-away** (no hot camera left running); handle permission-denied and insecure-context with a clear message + the manual-entry fallback.

Keep it mobile-first (this role is phone-only), S-grammar consistent with the salesman app (hairlines, mono figures, ≥48px tap targets).

---

## Commit 4 — Accountant workbench: serials + process

- **`src/app/dashboard/orders/[id]/page.tsx`**: also fetch `order_item_scans` (serial, scanned_at, the line it belongs to) and pass to the workbench.
- **`OrderWorkbench.tsx`**:
  - Show a **SERIALS / TRACKING** section for `ready_to_bill` (and `processed`) orders — per line, the list of scanned serials the accountant reads into Tally. Include a **copy-all** affordance (tap to copy the serials) since they're re-typing into Tally.
  - **"Mark processed"** must appear for `ready_to_bill` (currently only `submitted`/`approved`) → `process_order` (already updated in commit 1).
  - Byline: when `picked_at` is set, note "· picked {time}{ by name}".

---

## Serial helper (shared, `src/lib/serial.ts`)
```ts
const SERIAL_RE = /\d{3}[A-Z]{4}\d{6}/;
export function extractSerial(raw: string): { serial: string; parsed: boolean } {
  const m = raw.match(SERIAL_RE);
  return m ? { serial: m[0], parsed: true } : { serial: raw.trim(), parsed: false };
}
```
Client uses it for live display; the `submit_pick` RPC re-derives server-side (authoritative). Always store `raw_scan` too.

## Acceptance (reviewer verifies by execution — several roles + a phone/mobile viewport)
- **Godown gate:** a `godown` user lands on `/godown`, sees only approved/ready_to_bill **LG** orders (no fixed-brand orders, no prices anywhere), and is redirected off `/` and `/dashboard`; non-godown users are redirected off `/godown`.
- **Scan flow:** on a phone (deployed HTTPS URL), scanning an LG serial barcode extracts the clean 13-char serial; a line can't exceed its qty; Submit is blocked until every line is complete; on submit the order → `ready_to_bill`, leaves the godown queue, and appears in the accountant's **Ready to bill** tab within ~5s (Realtime).
- **Serial integrity:** `submit_pick` stores server-extracted serials + raw; a duplicate serial (same unit on a second order) is rejected; an unparsed scan can be hand-entered.
- **Accountant:** opens a `ready_to_bill` order, sees the serial list (copyable), and **Mark processed** works (`ready_to_bill → processed`). The **`approved → processed` override still works**.
- **State machine:** `approved → ready_to_bill` only by godown; `ready_to_bill → processed/cancelled` by accountant/admin; every pre-existing transition unchanged; cancelling a picked order frees its serials (re-scannable).
- **Salesman:** sees `ready_to_bill` as read-only "ready to bill"; can't reach `/godown`.
- `npm run build` + `tsc` + eslint clean; types regenerated.

## Guardrails
- **LG-only** — the scan/pick flow applies only to approval (LG) orders; fixed brands (Zebronics/Luminous) are untouched (`submitted → processed` as today).
- **Prices hidden in the godown UI** — don't render them; the queries shouldn't even select price columns for the godown. (No server-side price-stripping needed — owner decision.)
- Don't regress the approval chain, the accountant/admin dashboards, RLS isolation, immutable order snapshots, or the salesman flow. Scans are additive; `order_ref` and existing `order_items` snapshots are never mutated.
- Migration filename = 14-digit, no `T`, reconciled to the ledger version.
