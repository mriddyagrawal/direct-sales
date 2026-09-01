-- EXPAND migration (owner go-ahead 2026-08-31; contract half comes at merge).
-- Applied to prod AHEAD of the code deploy, so it must be — and is —
-- NON-BREAKING for the app that is live right now:
--   · columns are additive (nullable / defaulted);
--   · the OLD create_deposit/update_deposit signatures are LEFT STANDING so
--     the deployed form keeps saving deposits (sans receipt/discount) during
--     the test window; the new signatures are added ALONGSIDE as overloads.
-- PostgREST disambiguates the overloads by the keys the caller provides: an
-- old-shape call lacks p_receipt_ref (REQUIRED, no default, in the new
-- signature) so it can only match the old one; a new-shape call carries keys
-- the old signature doesn't have. Probe both shapes after applying — a
-- PGRST203 ambiguity error means back out the new overloads and fall back to
-- a coordinated apply+deploy cutover.
-- A follow-up CONTRACT migration drops the old signatures when this branch
-- merges — do not leave permissive-era signatures behind long-term.
-- After applying, regenerate src/lib/types/database.types.ts — the branch
-- carries a hand-extension that must be replaced by the generator's output.
-- The branch itself must still NOT merge before this applies:
-- DEPOSITS_LIST_SELECT names these columns and would 400 without them.
--
-- Deposits gain the paper-receipt reference and a discount (owner 2026-08-31):
--
--   AMOUNT stays the GROSS figure knocked off the retailer's balance
--   (₹10,000 in the owner's worked example); DISCOUNT is the concession
--   (₹500); the money that changed hands is the NET (₹9,500), always derived,
--   never stored — arithmetic that isn't stored can't disagree with itself.
--   Existing rows: discount 0, so gross = net and their meaning is unchanged.
--
--   receipt_ref is the number off the salesman's PAPER receipt book — the
--   bridge between the app row and the paper trail. Free text ("A-123" is a
--   real shape), REQUIRED on every new write, nullable in the schema because
--   history predates it. NOT unique, deliberately: each salesman carries his
--   own book, so the same number recurs across salesmen by design, and even
--   per-salesman it is a WARN in the client, never a DB block (books restart,
--   get replaced, get re-issued — a hard constraint would refuse a legitimate
--   entry at 7pm in a shop). The client warns on a same-salesman duplicate;
--   the server stays permissive on purpose.

alter table public.deposits
  add column receipt_ref   text,
  add column discount_paise integer not null default 0;

-- Belt and braces at the table level: the RPCs validate too, but the CHECK
-- holds against any future write path. Strictly less than the amount —
-- discount == amount is a write-off, not a deposit. Safe for existing rows
-- (discount 0, amount > 0 always).
alter table public.deposits
  add constraint deposits_discount_lt_amount
  check (discount_paise >= 0 and discount_paise < amount_paise);

-- The new-signature RPCs. NOTE: `create or replace` with a different
-- parameter list does not replace — it creates an OVERLOAD beside the old
-- function. Here that is DELIBERATE (see header): the old signatures keep
-- the deployed app alive until the contract migration retires them.

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
  values (v_no, 'DEP-'||v_no, p_retailer_id, v_caller, p_amount_paise, p_discount_paise, btrim(p_receipt_ref), p_method, nullif(btrim(p_note), ''), now() + interval '1 hour')
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'created',
          jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                             'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref,
                             'method', v_row.method, 'note', v_row.note));
  return v_row;
end; $$;

create or replace function public.update_deposit(
  p_id uuid,
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
  if p_method is null or p_method not in ('cash','cheque','online') then raise exception 'invalid method %', p_method; end if;
  if p_method = 'cheque' and (p_note is null or btrim(p_note) = '') then raise exception 'the cheque number is required'; end if;
  if p_method = 'online' and (p_note is null or btrim(p_note) = '') then raise exception 'the UPI reference is required'; end if;
  if not exists (select 1 from public.retailers where id = p_retailer_id) then raise exception 'retailer % not found', p_retailer_id; end if;
  v_before := jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                                 'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref,
                                 'method', v_row.method, 'note', v_row.note);
  -- Only retailer/amount/discount/receipt_ref/method/note ever change —
  -- deposit_no/created_at/editable_until/salesman_id stay immutable.
  update public.deposits
     set retailer_id = p_retailer_id, amount_paise = p_amount_paise, discount_paise = p_discount_paise,
         receipt_ref = btrim(p_receipt_ref), method = p_method, note = nullif(btrim(p_note), '')
   where id = p_id
  returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'updated', jsonb_build_object(
    'before', v_before,
    'after', jsonb_build_object('retailer_id', v_row.retailer_id, 'amount_paise', v_row.amount_paise,
                                'discount_paise', v_row.discount_paise, 'receipt_ref', v_row.receipt_ref,
                                'method', v_row.method, 'note', v_row.note)));
  return v_row;
end; $$;

grant execute on function public.create_deposit(uuid, integer, text, text, integer, text) to authenticated;
grant execute on function public.update_deposit(uuid, uuid, integer, text, text, integer, text) to authenticated;
