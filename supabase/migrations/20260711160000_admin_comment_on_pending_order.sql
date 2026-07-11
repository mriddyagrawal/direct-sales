-- Admin comment on a pending_approval order (owner decision 2026-07-11).
-- A single overwritable note, admin-only write, visible to everyone who can
-- SELECT the order (rides the RLS'd row — no RLS change). Never changes status.

alter table public.orders add column if not exists admin_comment text;

create or replace function public.set_admin_comment(p_order_id uuid, p_comment text)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_role   text := public.auth_profile_role();
  v_order  public.orders;
  v_clean  text := nullif(btrim(p_comment), '');  -- empty submission clears the note
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;
  if v_role <> 'admin' then
    raise exception 'only admin may comment on orders';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  -- The comment is a held-stage annotation — pending_approval only.
  if v_order.status <> 'pending_approval' then
    raise exception 'comments are only allowed on a pending_approval order (status=%)', v_order.status;
  end if;

  update public.orders set admin_comment = v_clean where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'commented', jsonb_build_object('comment', v_clean));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;
