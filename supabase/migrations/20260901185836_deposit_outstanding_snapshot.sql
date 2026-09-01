-- The deposit row gains its OUTSTANDING SNAPSHOT (owner 2026-09-01): at the
-- moment of recording, create_deposit stamps previous_outstanding_paise from
-- retailers.outstanding_paise — the Tally figure AS OF THAT MOMENT, frozen on
-- the row even as later syncs move the live number. Feeds the deposits-page
-- display (red = owed, green = clear/advance; null = pre-snapshot row, shown
-- as a dash). The p_previous_outstanding_paise parameter is now IGNORED
-- (kept only so the signature — and PostgREST resolution — stays identical:
-- this is an in-place CREATE OR REPLACE, no overload dance, non-breaking,
-- paste anytime). update_deposit is untouched: edits pass the stored value
-- through, so the snapshot survives corrections.
-- Body otherwise identical to the applied …072822 version (godown role,
-- 30-minute window, receipt required, gross/discount rules).

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
  v_row public.deposits; v_no integer; v_prev integer;
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
  -- The snapshot: the Tally-synced outstanding AS OF THIS MOMENT. May be
  -- null (never-synced shop) — the display shows a dash; the WhatsApp
  -- receipt treats null as 0 by the owner's rule.
  select outstanding_paise into v_prev from public.retailers where id = p_retailer_id;
  v_no := nextval('public.deposit_no_seq');
  insert into public.deposits (deposit_no, deposit_ref, retailer_id, salesman_id, amount_paise, discount_paise, receipt_ref, previous_outstanding_paise, method, note, editable_until)
  values (v_no, 'DEP-'||v_no, p_retailer_id, v_caller, p_amount_paise, p_discount_paise, btrim(p_receipt_ref), v_prev, p_method, nullif(btrim(p_note), ''), now() + interval '30 minutes')
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'created',
          jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                             'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref, 'previous_outstanding_paise', v_row.previous_outstanding_paise,
                             'method', v_row.method, 'note', v_row.note));
  return v_row;
end; $$;
