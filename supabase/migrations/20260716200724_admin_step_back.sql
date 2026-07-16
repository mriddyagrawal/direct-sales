-- Admin "Undo" (step-back one stage, owner 2026-07-17): four admin-only
-- backward edges in the guard + step_back_order RPC. Reason-free by design
-- (every step auto-audited as a 'stepped_back' event). Cancelled is FINAL.

-- A. guard_order_transition — recreated: current forward edges verbatim, plus
-- the four backward edges checked FIRST (admin-only).
create or replace function public.guard_order_transition()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = old.status then return new; end if;
  -- ADMIN STEP-BACK (owner 2026-07-17): the four backward edges, admin-only.
  if (old.status = 'approved'      and new.status = 'pending_approval')
  or (old.status = 'ready_to_bill' and new.status = 'approved')
  or (old.status = 'billed'        and new.status = 'ready_to_bill')
  or (old.status = 'dispatched'    and new.status = 'billed') then
    if public.auth_profile_role() = 'admin' then return new; end if;
    raise exception 'only admin may step an order back (order %)', old.id;
  end if;
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
  if old.status = 'approved' and new.status = 'backorder' then return new; end if;
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

-- B. step_back_order — admin-only, one stage back, stamps of that stage cleared.
create or replace function public.step_back_order(p_order_id uuid)
returns orders language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid(); v_role text := public.auth_profile_role();
  v_order public.orders; v_child public.orders; v_to text;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role <> 'admin' then raise exception 'only admin may undo a step'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;

  if v_order.status = 'approved' then
    v_to := 'pending_approval';
    update public.orders set status='pending_approval', approved_at=null, approved_by=null where id=p_order_id;
  elsif v_order.status = 'billed' then
    -- status + bill-no cleared in ONE update (the bill-no CHECK is row-wise).
    v_to := 'ready_to_bill';
    update public.orders set status='ready_to_bill', tally_bill_no=null, processed_at=null, processed_by=null where id=p_order_id;
  elsif v_order.status = 'dispatched' then
    -- tally_bill_no kept: the CHECK requires it on a billed row.
    v_to := 'billed';
    update public.orders set status='billed', dispatched_at=null, dispatched_by=null, dispatch_note=null where id=p_order_id;
  elsif v_order.status = 'ready_to_bill' then
    -- UN-PICK. An untouched backorder child is cancelled inline (mirrors
    -- cancel_order's writes; not called — its role/reason gates are for users).
    -- An ADVANCED child blocks the undo; nothing is changed.
    v_to := 'approved';
    select * into v_child from public.orders where parent_order_id = p_order_id and status <> 'cancelled' limit 1;
    if found then
      if v_child.status = 'backorder' then
        update public.orders set status='cancelled', cancelled_at=now(), cancelled_by=v_caller where id=v_child.id;
        insert into public.order_events (order_id, actor_id, action, details)
        values (v_child.id, v_caller, 'cancelled',
                jsonb_build_object('reason', 'Original order (#'||v_order.order_ref||') pushed back to ''Approved'' status.'));
      else
        raise exception 'blocked: finish or cancel backorder % first', v_child.order_ref;
      end if;
    end if;
    delete from public.order_item_scans where order_item_id in (select id from public.order_items where order_id = p_order_id);
    -- picked_qty -> NULL fires recompute_order_total (coalesce(picked_qty, qty)),
    -- restoring total_paise to the full ordered amount.
    update public.order_items set picked_qty = null where order_id = p_order_id;
    update public.orders set status='approved', picked_at=null, picked_by=null where id=p_order_id;
  else
    raise exception 'order % cannot be stepped back from status %', p_order_id, v_order.status;
  end if;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'stepped_back', jsonb_build_object('from', v_order.status, 'to', v_to));
  select * into v_order from public.orders where id = p_order_id; return v_order;
end; $$;

grant execute on function public.step_back_order(uuid) to authenticated;
