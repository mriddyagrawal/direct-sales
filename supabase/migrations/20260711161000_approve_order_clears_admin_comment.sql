-- Approving a held order clears its admin comment (owner decision 2026-07-11):
-- the note is a "why it's held" annotation, so it's meaningless once approved.
-- The `commented` order_event stays in history (audit trail) regardless.

create or replace function public.approve_order(p_order_id uuid)
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
  if v_role <> 'admin' then
    raise exception 'only admin may approve orders';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status <> 'pending_approval' then
    raise exception 'order % is not pending approval (status=%)', p_order_id, v_order.status;
  end if;

  -- All brands go to the godown pick stage; clear the held-stage admin comment.
  update public.orders
     set status = 'approved', approved_at = now(), approved_by = v_caller, admin_comment = null
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'approved', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;
