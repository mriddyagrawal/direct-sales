-- One-time backfill: set tally_name = name for every product where
-- tally_name is still NULL (owner-requested 2026-07-07). The Products
-- screen (ProductsPricing.tsx) already falls back to `name` for display
-- when tally_name is NULL and never copies it on save — this migration
-- is a one-off data seed, not a change to that app-level behavior. Note
-- this does mean the 41 backfilled rows are no longer distinguishable
-- from a row an accountant explicitly confirmed against the real Tally
-- ledger; any future edit through the Products screen still stores
-- exactly what's typed (including clearing it back to NULL).

update public.products
set tally_name = name
where tally_name is null;
