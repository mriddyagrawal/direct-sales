-- Retailer credit & ledger (docs/specs/retailer-credit-ledger.md v2.3).
-- Owner-approved 2026-07-31, APPLIED to prod (ledger version 20260731003235).
-- Tally is the ONLY source of both; the app never writes a balance or an entry
-- of its own.

-- The balance lives on `retailers` rather than a side table: the owner decided
-- every role may see it, which removed the only strong reason to separate it,
-- and the retailer picker already fetches this table so the figure arrives with
-- no join. NULL means "not in the last sync" — deliberately distinct from 0,
-- which means Tally says the shop is square.
alter table public.retailers
  add column outstanding_paise bigint,      -- POSITIVE = the shop owes us
  add column balance_as_of     timestamptz; -- without this, a 3-week-old figure
                                            -- is indistinguishable from a fresh one

-- One row per ledger entry (bill / receipt / credit note / journal leg) for the
-- synced window. Replaced wholesale by date range on every sync, which is what
-- makes a voucher DELETED in Tally disappear here too.
create table public.retailer_ledger_entries (
  id           bigserial primary key,
  retailer_id  uuid not null references public.retailers(id) on delete cascade,
  entry_date   date not null,
  voucher_type text not null,
  voucher_no   text,
  debit_paise  bigint not null default 0 check (debit_paise  >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0)
);

create index retailer_ledger_entries_retailer_date_idx
  on public.retailer_ledger_entries (retailer_id, entry_date desc);

alter table public.retailer_ledger_entries enable row level security;

-- Owner decision 2026-07-31: salesmen see the statement exactly as staff do.
-- One rule for the whole feature — if you can see what a shop owes, you can see why.
create policy ledger_entries_select_all on public.retailer_ledger_entries
  for select using (public.auth_profile_role() is not null);

-- No insert/update/delete policy on purpose: every write goes through a
-- SECURITY DEFINER import RPC, so there is no path by which the app or a
-- salesman session can invent a ledger line.
