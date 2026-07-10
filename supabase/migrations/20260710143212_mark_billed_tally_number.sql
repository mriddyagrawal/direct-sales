-- Mark billed requires a Tally bill number.
-- Adds a nullable text column (pre-existing billed orders have none) and
-- recreates process_order to take + validate (non-empty only) the bill number.

alter table public.orders add column tally_bill_no text;

-- Drop the old 1-arg overload FIRST. A CREATE OR REPLACE with the new
-- (uuid, text) signature would only ADD an overload, leaving the old
-- process_order(uuid) callable — a hole that bills with no bill number.
drop function if exists public.process_order(uuid);

create function public.process_order(p_order_id uuid, p_bill_no text)
  returns orders
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_role   text := public.auth_profile_role();
  v_order  public.orders;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  if v_role not in ('accountant', 'admin') then
    raise exception 'only accountant/admin may bill orders';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'pending_approval' then
    raise exception 'order % must be approved before it can be billed', p_order_id;
  end if;
  if v_order.status not in ('approved', 'ready_to_bill') then
    raise exception 'order % is not billable (status=%)', p_order_id, v_order.status;
  end if;

  -- The ONLY bill-number validation (owner: "just simple empty or not").
  if p_bill_no is null or btrim(p_bill_no) = '' then
    raise exception 'a Tally bill number is required to bill order %', p_order_id;
  end if;

  update public.orders
     set status = 'billed', processed_at = now(), processed_by = v_caller, tally_bill_no = btrim(p_bill_no)
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'billed', jsonb_build_object('bill_no', btrim(p_bill_no)));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;

-- Replicate the dropped function's grants EXACTLY: postgres owner (implicit),
-- authenticated + service_role EXECUTE, anon NONE. Supabase default privileges
-- auto-grant EXECUTE to anon on new public functions, and `revoke ... from
-- public` does not touch the role-specific anon grant — so revoke anon
-- explicitly, or a fresh replay would leave anon able to call it.
revoke all on function public.process_order(uuid, text) from public;
revoke execute on function public.process_order(uuid, text) from anon;
grant execute on function public.process_order(uuid, text) to authenticated, service_role;
