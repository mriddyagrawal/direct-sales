-- Godown workers may record deposits (owner 2026-09-01) — the counter case:
-- a retailer paying while collecting goods. One word: 'godown' joins the
-- role list in create_deposit. Everything else was already ownership-based,
-- not role-based, so it follows for free: SELECT is salesman_id = auth.uid()
-- (their own rows appear), edit/void is creator-in-window, the retailer
-- picker works because retailers_select_godown has existed since fulfilment.
--
-- ⚠️ SUPERSEDES 20260901043529 (the 30-minute window): this body is that
-- one's, re-emitted with the wider role list — it carries BOTH changes.
-- If the 30m file was never applied, apply ONLY this one. If you apply both,
-- apply this one LAST — running the 30m file after this would silently
-- revert the godown grant (create or replace, same signature).

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
  if v_role not in ('salesman','accountant','admin','godown') then raise exception 'role % cannot record deposits', v_role; end if;
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
