-- The salesman's edit window shrinks: 1 hour -> 30 MINUTES (owner 2026-09-01).
--
-- editable_until is stamped ONCE, at insert, inside create_deposit — update
-- and void only compare against it. So this re-emits create_deposit (same
-- signature, in-place replace, no overload) with the single interval changed,
-- and applies ONLY to deposits recorded after it runs: rows already carrying
-- a 1-hour stamp keep it, deliberately — a window someone is standing inside
-- does not get yanked. Admin rights are unaffected (admin edits/voids anytime).
--
-- Body is otherwise byte-identical to 20260901032758's create_deposit.

create or replace function public.create_deposit(
  p_retailer_id uuid,
  p_amount_paise integer,
  p_method text,
  p_receipt_ref text,
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
  if v_role not in ('salesman','accountant','admin') then raise exception 'role % cannot record deposits', v_role; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_discount_paise is null or p_discount_paise < 0 then raise exception 'discount cannot be negative'; end if;
  if p_discount_paise >= p_amount_paise then raise exception 'discount must be less than the amount'; end if;
  if p_receipt_ref is null or btrim(p_receipt_ref) = '' then raise exception 'the paper receipt number is required'; end if;
  if p_method is null or p_method not in ('cash','cheque','online') then raise exception 'invalid method %', p_method; end if;
  -- The note IS the cheque number / UPI reference for those methods — the
  -- server enforces what the form's labeling promises (rules live in the DB).
  if p_method = 'cheque' and (p_note is null or btrim(p_note) = '') then raise exception 'the cheque number is required'; end if;
  if p_method = 'online' and (p_note is null or btrim(p_note) = '') then raise exception 'the UPI reference is required'; end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then raise exception 'retailer % not found', p_retailer_id; end if;
  v_no := nextval('public.deposit_no_seq');
  insert into public.deposits (deposit_no, deposit_ref, retailer_id, salesman_id, amount_paise, discount_paise, receipt_ref, method, note, editable_until)
  values (v_no, 'DEP-'||v_no, p_retailer_id, v_caller, p_amount_paise, p_discount_paise, btrim(p_receipt_ref), p_method, nullif(btrim(p_note), ''), now() + interval '30 minutes')
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'created',
          jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                             'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref,
                             'method', v_row.method, 'note', v_row.note));
  return v_row;
end; $$;
