# Builder prompt — Mark billed requires the Tally bill number

When staff bill an order (**Mark billed**, from `approved` override or
`ready_to_bill`), they must enter the **Tally bill number**. The **only**
validation is non-empty — no format/uniqueness check. Store it on the order and
show it on the billed order. Small, self-contained; **one migration + one FE
commit**. Lifecycle context: [docs/specs/order-lifecycle.md](../docs/specs/order-lifecycle.md).

## 1. Migration (14-digit `YYYYMMDDHHMMSS`, no `T`; apply via MCP; reconcile the repo filename to the ledger version)
- **Column:** `alter table public.orders add column tally_bill_no text;` (nullable —
  the 3 already-`billed` orders have none; that's fine).
- **Recreate `process_order`** to take a bill number. It currently is
  `process_order(p_order_id uuid)`; make it `process_order(p_order_id uuid, p_bill_no text)`:
  - After the existing role check (`accountant`/`admin` only) and the billable-
    status checks, **validate non-empty**: `if p_bill_no is null or btrim(p_bill_no) = '' then raise exception 'a Tally bill number is required to bill order %', p_order_id; end if;`
  - `update … set status='billed', processed_at=now(), processed_by=v_caller, tally_bill_no = btrim(p_bill_no) …`
  - Include it in the event: `insert into order_events (…, 'billed', jsonb_build_object('bill_no', btrim(p_bill_no)))`.
  - Everything else (name, `processed_at/by` plumbing, the `pending_approval` guard,
    the `('approved','ready_to_bill')` billable set) stays **byte-identical**.
- **Regenerate** `src/lib/types/database.types.ts` (new column + the `process_order`
  arg).

## 2. Frontend (one commit)
- **`src/lib/order-rpcs.ts`** — `processOrder(orderId, billNo)`: pass
  `p_bill_no: billNo`.
- **`src/components/orders/OrderDetailView.tsx`** — the **`confirmProcess`
  BottomSheet** (the "Mark {ref} billed?" sheet, used by BOTH the
  `ready_to_bill` and `approved`-override buttons) gains a **required text input**
  labelled "Tally bill number". Add a `billNo` state; `handleProcess` blocks with
  an inline error if it's empty (`"Enter the Tally bill number."`) and otherwise
  calls `processOrder(order.id, billNo.trim())`. Keep the existing "salesman app
  goes read-only" note.
- **`src/components/orders/order-detail-data.ts`** — add `tally_bill_no` to
  `ORDER_DETAIL_SELECT`, `tallyBillNo` to `OrderDetailData` / `toOrderDetailProps`.
- **Display — webapp:** on a `billed` order, append the bill number to the billed
  byline (e.g. `… · billed {time} by {name} · Bill #{tallyBillNo}`), rendered only
  when present (older billed orders are null → no `Bill #`).
- **Display — PDF** ([src/app/orders/[id]/pdf/PickSlipPdf.tsx](../src/app/orders/[id]/pdf/PickSlipPdf.tsx) + its
  `route.ts`): the number belongs on the ORDER COPY too. Add `tally_bill_no` to the
  route's `select`, pass a `tallyBillNo` prop through `renderPickSlipPdfBuffer`, and
  render it in the **`metaBlock`** (beside Submitted / Retailer / Salesman) as a
  `Bill No: {tallyBillNo}` line — **only when present** (null → omit the line, no
  empty label). That's the recommended spot; the builder may pick a cleaner
  placement (e.g. under the status in the badge column) as long as it only shows
  when billed.

## Acceptance (reviewer verifies by execution — live, rolled back)
- Billing an order with an **empty** bill number is rejected **both** client-side
  (button blocked, inline error) **and** server-side (`process_order` raises) —
  prove the RPC rejection with a direct empty call.
- Billing with a bill number stores it in `orders.tally_bill_no`, logs it in the
  `billed` event details, and it shows on the billed order's byline **and on the
  generated PDF** (metaBlock `Bill No:` line); a non-billed / null order's PDF omits
  the line entirely.
- Works from **both** billing paths (`ready_to_bill` normal + `approved` override).
- The 3 pre-existing `billed` orders (null bill no) still render — no `Bill #`,
  no crash.
- `npm run build` + `tsc` + eslint clean; types regenerated; migration filename
  reconciled.

## Guardrails
- **Only** the non-empty check — no format, length, or uniqueness validation
  (owner: "just simple empty or not").
- Keep the `process_order` name + `processed_at`/`processed_by` columns (plumbing).
- Money/pricing untouched; this adds one text column + one required arg.
- Don't change who can bill (accountant/admin) or the billable-status set.
