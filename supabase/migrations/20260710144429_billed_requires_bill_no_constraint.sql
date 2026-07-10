-- Make the Tally bill number a hard table invariant for billed orders (not
-- just an RPC guard): a billed order MUST carry a non-blank bill number.
-- Non-billed states keep a null bill number, so this is a partial CHECK, not
-- NOT NULL.

-- Backfill the pre-existing billed orders (dev/test data, all null) first so
-- the constraint validates cleanly. Marked LEGACY- so nobody mistakes a
-- backfill for a real Tally number (bill numbers need not be unique).
update public.orders
   set tally_bill_no = 'LEGACY-' || order_ref
 where status = 'billed'
   and (tally_bill_no is null or btrim(tally_bill_no) = '');

alter table public.orders
  add constraint orders_billed_requires_bill_no
  check (status <> 'billed' or (tally_bill_no is not null and btrim(tally_bill_no) <> ''));
