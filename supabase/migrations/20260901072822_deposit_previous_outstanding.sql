-- EXPAND: deposits gain PREVIOUS OUTSTANDING (owner 2026-09-01), the figure
-- the WhatsApp receipt's outstanding lines are built from. Deliberately
-- SALESMAN-ENTERED, not pulled from the Tally sync (owner call): the sync is
-- as-of-last-run, and a stale figure in an anti-fraud message costs trust.
-- The CURRENT outstanding is previous − net, derived, never stored — same
-- rule as the net itself.
--
-- Optional (nullable): a deposit without it saves fine and simply sends no
-- WhatsApp receipt (the template requires the value) — the rollout lever.
-- No CHECK: a negative outstanding is a real state (advance-paid shop),
-- though the form only produces null/0/positive today.
--
-- Same expand/contract dance as the receipt work: the new signatures take
-- p_previous_outstanding_paise as a REQUIRED param (no default) so PostgREST
-- overload resolution stays unambiguous — old-shape calls (deployed form)
-- match only the old signatures, which stand until the contract migration
-- retires them AFTER this branch deploys.
-- create_deposit body from …053627 (godown+30m), update_deposit from …032758.

alter table public.deposits
  add column previous_outstanding_paise integer;

create or replace function public.create_deposit(
  p_retailer_id uuid,
  p_amount_paise integer,
  p_method text,
  p_receipt_ref text,
  p_previous_outstanding_paise integer,
  p_discount_paise integer default 0,
  p_note text default null
)
returns deposits language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_row public.deposits; v_no integer;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role not in ('salesman','accountant','admin','godown') then raise exception 'role % cannot record deposits', v_role; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_discount_paise is null or p_discount_paise < 0 then raise exception 'discount cannot be negative'; end if;
  if p_discount_paise >= p_amount_paise then raise exception 'discount must be less than the amount'; end if;
  if p_receipt_ref is null or btrim(p_receipt_ref) = '' then raise exception 'the paper receipt number is required'; end if;
  if p_previous_outstanding_paise is not null and p_previous_outstanding_paise < 0 then raise exception 'outstanding cannot be negative'; end if;
  if p_method is null or p_method not in ('cash','cheque','online') then raise exception 'invalid method %', p_method; end if;
  -- The note IS the cheque number / UPI reference for those methods — the
  -- server enforces what the form's labeling promises (rules live in the DB).
  if p_method = 'cheque' and (p_note is null or btrim(p_note) = '') then raise exception 'the cheque number is required'; end if;
  if p_method = 'online' and (p_note is null or btrim(p_note) = '') then raise exception 'the UPI reference is required'; end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then raise exception 'retailer % not found', p_retailer_id; end if;
  v_no := nextval('public.deposit_no_seq');
  insert into public.deposits (deposit_no, deposit_ref, retailer_id, salesman_id, amount_paise, discount_paise, receipt_ref, previous_outstanding_paise, method, note, editable_until)
  values (v_no, 'DEP-'||v_no, p_retailer_id, v_caller, p_amount_paise, p_discount_paise, btrim(p_receipt_ref), p_previous_outstanding_paise, p_method, nullif(btrim(p_note), ''), now() + interval '30 minutes')
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'created',
          jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                             'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref, 'previous_outstanding_paise', v_row.previous_outstanding_paise,
                             'method', v_row.method, 'note', v_row.note));
  return v_row;
end; $$;

create or replace function public.update_deposit(
  p_id uuid,
  p_retailer_id uuid,
  p_amount_paise integer,
  p_method text,
  p_receipt_ref text,
  p_previous_outstanding_paise integer,
  p_discount_paise integer default 0,
  p_note text default null
)
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
  if p_discount_paise is null or p_discount_paise < 0 then raise exception 'discount cannot be negative'; end if;
  if p_discount_paise >= p_amount_paise then raise exception 'discount must be less than the amount'; end if;
  -- Required on update too, INCLUDING a legacy row (receipt_ref null): the
  -- editor is holding the book or the row — supplying the number is the point
  -- of touching it. Symmetric with create; no partial-patch semantics here.
  if p_receipt_ref is null or btrim(p_receipt_ref) = '' then raise exception 'the paper receipt number is required'; end if;
  if p_previous_outstanding_paise is not null and p_previous_outstanding_paise < 0 then raise exception 'outstanding cannot be negative'; end if;
  if p_method is null or p_method not in ('cash','cheque','online') then raise exception 'invalid method %', p_method; end if;
  if p_method = 'cheque' and (p_note is null or btrim(p_note) = '') then raise exception 'the cheque number is required'; end if;
  if p_method = 'online' and (p_note is null or btrim(p_note) = '') then raise exception 'the UPI reference is required'; end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then raise exception 'retailer % not found', p_retailer_id; end if;
  v_before := jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                                 'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref,
                                 'previous_outstanding_paise', v_row.previous_outstanding_paise,
                                 'method', v_row.method, 'note', v_row.note);
  -- Only retailer/amount/discount/receipt_ref/previous_outstanding/method/
  -- note ever change — deposit_no/created_at/editable_until/salesman_id
  -- stay immutable.
  update public.deposits
     set retailer_id = p_retailer_id, amount_paise = p_amount_paise, discount_paise = p_discount_paise,
         receipt_ref = btrim(p_receipt_ref), previous_outstanding_paise = p_previous_outstanding_paise,
         method = p_method, note = nullif(btrim(p_note), '')
   where id = p_id
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'updated', jsonb_build_object(
    'before', v_before,
    'after', jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                                'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref, 'previous_outstanding_paise', v_row.previous_outstanding_paise,
                                'method', v_row.method, 'note', v_row.note)));
  return v_row;
end; $$;

grant execute on function public.create_deposit(uuid, integer, text, text, integer, integer, text) to authenticated;
grant execute on function public.update_deposit(uuid, uuid, integer, text, text, integer, integer, text) to authenticated;
