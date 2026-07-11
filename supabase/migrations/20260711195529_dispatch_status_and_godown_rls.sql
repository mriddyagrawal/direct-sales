-- STAGE 2: dispatched status + dispatch_order + godown RLS widening (owner-approved 2026-07-12).
-- Additive: one status, two columns, one RPC, two guard edges, additive godown SELECT RLS.
-- cancel_order is intentionally UNCHANGED — dispatched->cancelled is admin-only (accountant
-- stays pending-only per the cancel/edit matrix), enforced by the existing admin branch.

alter table public.orders
  add column dispatched_at timestamptz,
  add column dispatched_by uuid references public.profiles(id);

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status = any (array['backorder','pending_approval','approved','ready_to_bill','billed','dispatched','cancelled']));

alter table public.orders drop constraint orders_billed_requires_bill_no;
alter table public.orders add constraint orders_billed_requires_bill_no
  check (status not in ('billed','dispatched') or (tally_bill_no is not null and btrim(tally_bill_no) <> ''));

CREATE OR REPLACE FUNCTION public.guard_order_transition()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'pending_approval' then
    if old.status <> 'backorder' then raise exception 'illegal order status transition: % -> pending_approval (order %)', old.status, old.id; end if;
    if public.auth_profile_role() = 'admin' or old.salesman_id = auth.uid() then return new; end if;
    raise exception 'only the salesman or an admin may punch this backorder (order %)', old.id;
  end if;
  if new.status = 'approved' then
    if old.status <> 'pending_approval' then raise exception 'illegal order status transition: % -> approved (order %)', old.status, old.id; end if;
    if public.auth_profile_role() <> 'admin' then raise exception 'only admin may approve orders (order %)', old.id; end if;
    return new;
  end if;
  if new.status = 'ready_to_bill' then
    if old.status = 'approved' then return new; end if;
    raise exception 'illegal order status transition: % -> ready_to_bill (order %)', old.status, old.id;
  end if;
  if old.status = 'billed' and new.status = 'dispatched' then
    if public.auth_profile_role() in ('godown','accountant','admin') then return new; end if;
    raise exception 'only godown/accountant/admin may dispatch (order %)', old.id;
  end if;
  if old.status = 'pending_approval' and new.status = 'cancelled' then return new; end if;
  if old.status = 'approved' and new.status in ('billed','cancelled') then return new; end if;
  if old.status = 'ready_to_bill' and new.status in ('billed','cancelled') then return new; end if;
  if old.status = 'billed' and new.status = 'cancelled' then return new; end if;
  if old.status = 'dispatched' and new.status = 'cancelled' then return new; end if;
  if old.status = 'backorder' and new.status = 'cancelled' then return new; end if;
  raise exception 'illegal order status transition: % -> % (order %)', old.status, new.status, old.id;
end; $function$;

CREATE OR REPLACE FUNCTION public.dispatch_order(p_order_id uuid)
 RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_caller uuid := auth.uid(); v_role text := public.auth_profile_role(); v_order public.orders;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role not in ('godown','accountant','admin') then raise exception 'only godown/accountant/admin may dispatch orders'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if v_order.status <> 'billed' then raise exception 'order % is not dispatchable (status=%)', p_order_id, v_order.status; end if;
  update public.orders set status='dispatched', dispatched_at=now(), dispatched_by=v_caller where id=p_order_id;
  insert into public.order_events (order_id, actor_id, action, details) values (p_order_id, v_caller, 'dispatched', '{}'::jsonb);
  select * into v_order from public.orders where id=p_order_id; return v_order;
end; $function$;

grant execute on function public.dispatch_order(uuid) to authenticated;

alter policy orders_select_godown on public.orders
  using ((auth_profile_role() = 'godown') and (status = any (array['approved','ready_to_bill','billed','dispatched','cancelled'])));
alter policy order_items_select_godown on public.order_items
  using ((auth_profile_role() = 'godown') and (exists (select 1 from orders o where o.id = order_items.order_id and o.status = any (array['approved','ready_to_bill','billed','dispatched','cancelled']))));
alter policy order_item_scans_select_godown on public.order_item_scans
  using ((auth_profile_role() = 'godown') and (exists (select 1 from order_items oi join orders o on o.id = oi.order_id where oi.id = order_item_scans.order_item_id and o.status = any (array['approved','ready_to_bill','billed','dispatched','cancelled']))));
create policy order_events_select_godown on public.order_events for select
  using ((auth_profile_role() = 'godown') and (exists (select 1 from orders o where o.id = order_events.order_id and o.status = any (array['approved','ready_to_bill','billed','dispatched','cancelled']))));
