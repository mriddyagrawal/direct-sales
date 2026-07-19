-- Deposits (owner 2026-07-19): a positive ledger of cash collected — retailer,
-- amount (paise, > 0), method (cash/cheque/online), optional note. Not linked
-- to orders. Creator edits/deletes his own within a 1-HOUR window; past that
-- only an ADMIN corrects, and an admin's removal is a VOID (row kept, struck,
-- excluded from totals — never a hard delete). Every create/update/void is
-- audited in deposit_events (mirrors order_events).
--
-- NOTE: superseded minutes later by 20260719150009_deposits_void_for_all
-- (owner: the salesman's in-hour removal is a VOID too — delete_deposit is
-- dropped there and void_deposit widened to creator-in-window OR admin).

create sequence if not exists public.deposit_no_seq;

create table public.deposits (
  id             uuid primary key default gen_random_uuid(),
  deposit_no     integer not null default nextval('public.deposit_no_seq'),
  deposit_ref    text not null,                                 -- 'DEP-<no>' (RPC-set)
  retailer_id    uuid not null references public.retailers(id),
  salesman_id    uuid not null references public.profiles(id),  -- recorder/collector (= creator)
  amount_paise   integer not null check (amount_paise > 0),
  method         text not null check (method in ('cash','cheque','online')),
  note           text,
  editable_until timestamptz not null,                          -- created_at + 1 hour
  voided_at      timestamptz,                                   -- null = active
  voided_by      uuid references public.profiles(id),
  void_reason    text,
  created_at     timestamptz not null default now()
);
create index deposits_salesman_idx on public.deposits (salesman_id);
create index deposits_retailer_idx on public.deposits (retailer_id);
create index deposits_created_idx  on public.deposits (created_at desc);

create table public.deposit_events (
  id         bigserial primary key,
  deposit_id uuid not null references public.deposits(id) on delete cascade,
  actor_id   uuid references public.profiles(id),
  action     text not null,                 -- 'created' | 'updated' | 'voided'
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index deposit_events_deposit_idx on public.deposit_events (deposit_id);

alter table public.deposits enable row level security;
alter table public.deposit_events enable row level security;

-- SELECT only — every write goes through the RPCs below.
create policy deposits_select_salesman on public.deposits for select to authenticated
  using (salesman_id = auth.uid());
create policy deposits_select_staff on public.deposits for select to authenticated
  using (public.auth_profile_role() in ('admin','accountant'));
-- The audit log is an office concern — staff only.
create policy deposit_events_select_staff on public.deposit_events for select to authenticated
  using (public.auth_profile_role() in ('admin','accountant'));

create or replace function public.create_deposit(p_retailer_id uuid, p_amount_paise integer, p_method text, p_note text default null)
returns deposits language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_row public.deposits; v_no integer;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role not in ('salesman','accountant','admin') then raise exception 'role % cannot record deposits', v_role; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_method is null or p_method not in ('cash','cheque','online') then raise exception 'invalid method %', p_method; end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then raise exception 'retailer % not found', p_retailer_id; end if;
  v_no := nextval('public.deposit_no_seq');
  insert into public.deposits (deposit_no, deposit_ref, retailer_id, salesman_id, amount_paise, method, note, editable_until)
  values (v_no, 'DEP-'||v_no, p_retailer_id, v_caller, p_amount_paise, p_method, nullif(btrim(p_note), ''), now() + interval '1 hour')
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'created',
          jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise, 'method', v_row.method, 'note', v_row.note));
  return v_row;
end; $$;

create or replace function public.update_deposit(p_id uuid, p_retailer_id uuid, p_amount_paise integer, p_method text, p_note text default null)
returns deposits language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_row public.deposits; v_before jsonb;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  select * into v_row from public.deposits where id = p_id for update;
  if not found then raise exception 'deposit % not found', p_id; end if;
  if not ((v_row.salesman_id = v_caller and now() < v_row.editable_until and v_row.voided_at is null) or v_role = 'admin') then
    raise exception 'this deposit is locked — ask an admin to correct it';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_method is null or p_method not in ('cash','cheque','online') then raise exception 'invalid method %', p_method; end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then raise exception 'retailer % not found', p_retailer_id; end if;
  v_before := jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise, 'method', v_row.method, 'note', v_row.note);
  -- Only retailer/amount/method/note ever change — deposit_no/created_at/
  -- editable_until/salesman_id are immutable after insert.
  update public.deposits
     set retailer_id = p_retailer_id, amount_paise = p_amount_paise, method = p_method, note = nullif(btrim(p_note), '')
   where id = p_id
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'updated', jsonb_build_object(
    'before', v_before,
    'after', jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise, 'method', v_row.method, 'note', v_row.note)));
  return v_row;
end; $$;

create or replace function public.delete_deposit(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_row public.deposits;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  select * into v_row from public.deposits where id = p_id for update;
  if not found then raise exception 'deposit % not found', p_id; end if;
  -- A true delete is the CREATOR's fresh-mistake eraser, in-window only.
  -- Past the window (or for anyone else) the answer is an admin VOID.
  if not (v_row.salesman_id = v_caller and now() < v_row.editable_until and v_row.voided_at is null) then
    raise exception 'this deposit is locked — ask an admin to correct it';
  end if;
  delete from public.deposits where id = p_id; -- cascade removes its events
end; $$;

create or replace function public.void_deposit(p_id uuid, p_reason text)
returns deposits language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_row public.deposits;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role <> 'admin' then raise exception 'only admin may void a deposit'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required to void a deposit'; end if;
  select * into v_row from public.deposits where id = p_id for update;
  if not found then raise exception 'deposit % not found', p_id; end if;
  if v_row.voided_at is not null then raise exception 'deposit % is already voided', v_row.deposit_ref; end if;
  update public.deposits set voided_at = now(), voided_by = v_caller, void_reason = btrim(p_reason)
   where id = p_id returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'voided', jsonb_build_object('reason', btrim(p_reason)));
  return v_row;
end; $$;

grant execute on function public.create_deposit(uuid, integer, text, text) to authenticated;
grant execute on function public.update_deposit(uuid, uuid, integer, text, text) to authenticated;
grant execute on function public.delete_deposit(uuid) to authenticated;
grant execute on function public.void_deposit(uuid, text) to authenticated;
