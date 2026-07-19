-- Owner decision (2026-07-19, superseding the first cut minutes earlier):
-- NOTHING is ever hard-deleted. The salesman's in-hour removal is a VOID with
-- a required reason too — same mechanics as the admin's. delete_deposit is
-- dropped; void_deposit's gate widens to (creator in-window) OR admin.

drop function if exists public.delete_deposit(uuid);

create or replace function public.void_deposit(p_id uuid, p_reason text)
returns deposits language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_row public.deposits;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'a reason is required to void a deposit'; end if;
  select * into v_row from public.deposits where id = p_id for update;
  if not found then raise exception 'deposit % not found', p_id; end if;
  if v_row.voided_at is not null then raise exception 'deposit % is already voided', v_row.deposit_ref; end if;
  -- The creator within his 1-hour window, or an admin anytime. Reason always.
  if not ((v_row.salesman_id = v_caller and now() < v_row.editable_until) or v_role = 'admin') then
    raise exception 'this deposit is locked — ask an admin to correct it';
  end if;
  update public.deposits set voided_at = now(), voided_by = v_caller, void_reason = btrim(p_reason)
   where id = p_id returning * into v_row;
  insert into public.deposit_events (deposit_id, actor_id, action, details)
  values (v_row.id, v_caller, 'voided', jsonb_build_object('reason', btrim(p_reason)));
  return v_row;
end; $$;

grant execute on function public.void_deposit(uuid, text) to authenticated;
