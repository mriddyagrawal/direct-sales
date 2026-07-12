-- Dispatch remark (vehicle no. / LR no. / etc.) — owner request 2026-07-12.
-- Column stays NULLABLE for now (existing dispatched rows have none); the UI
-- requires it. A later migration can backfill + add NOT NULL. dispatch_order
-- gains an optional p_note; the old 1-arg version is dropped to avoid an
-- overload-ambiguity on the 1-arg call.

alter table public.orders add column dispatch_note text;

drop function if exists public.dispatch_order(uuid);

CREATE OR REPLACE FUNCTION public.dispatch_order(p_order_id uuid, p_note text DEFAULT NULL::text)
 RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role(); v_order public.orders;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role not in ('godown','accountant','admin') then raise exception 'only godown/accountant/admin may dispatch orders'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if v_order.status <> 'billed' then raise exception 'order % is not dispatchable (status=%)', p_order_id, v_order.status; end if;
  update public.orders set status='dispatched', dispatched_at=now(), dispatched_by=v_caller, dispatch_note=v_note where id=p_order_id;
  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'dispatched', case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
  select * into v_order from public.orders where id=p_order_id; return v_order;
end; $function$;

grant execute on function public.dispatch_order(uuid, text) to authenticated;
