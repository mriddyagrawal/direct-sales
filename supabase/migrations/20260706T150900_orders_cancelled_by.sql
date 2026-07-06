-- M1.9: orders.cancelled_by — mirrors processed_by (which already exists
-- alongside processed_at). Resolves REVIEWER flag (15): D8's "hide
-- self-cancelled orders from the salesman's own list" needs to distinguish
-- a self-cancel (salesman cancelled their own order — a mistake correction,
-- hide it) from an office-cancel (accountant/admin cancelled it — real news
-- the salesman must still see, or they risk a confused duplicate resubmit).
-- Without this column the only way to tell them apart is joining
-- order_events for the 'cancelled' action's actor_id on every list render;
-- a column matching the processed_at/processed_by pattern is cheaper and
-- more consistent with the existing schema shape.
--
-- Additive, nullable, backward compatible — no RLS change needed (existing
-- SELECT policies are row-scoped, not column-scoped, so the new column is
-- automatically visible wherever the row already is).

alter table public.orders add column cancelled_by uuid references public.profiles (id);

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller   uuid := auth.uid();
  v_role     text := public.auth_profile_role();
  v_order    public.orders;
  v_editable boolean;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order % is already cancelled', p_order_id;
  end if;

  v_editable := v_order.status = 'submitted' and v_order.editable_until > now();

  if v_role = 'salesman' then
    if v_order.salesman_id <> v_caller then
      raise exception 'not your order';
    end if;
    if not v_editable then
      raise exception 'edit window has passed; ask an accountant to cancel';
    end if;
  elsif v_role in ('accountant', 'admin') then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason is required for accountant/admin cancellation';
    end if;
  else
    raise exception 'role % cannot cancel orders', v_role;
  end if;

  update public.orders
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'cancelled',
          case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;
