-- Cancel / edit permissions + edit-window removal (owner decision 2026-07-11).
-- See docs/specs/cancel-edit-permissions-proposal.md. Recreates three functions:
--   • guard_order_transition — allow backorder -> cancelled
--   • cancel_order           — drop the 2h edit-window timer; accountant may
--                              cancel ONLY pending_approval; every other live
--                              state is admin-only; salesman only own pending.
--   • update_order_items     — drop the timer; salesman & accountant edit ONLY
--                              pending_approval; every post-approval state
--                              (backorder/approved/ready_to_bill/billed) is
--                              admin-only + reason-logged (edited_after_lock).
-- `editable_until` is retained (still written by submit_order) but no longer
-- read for gating. Fully reversible via CREATE OR REPLACE of the prior bodies.

-- ── 1. State-machine: a backorder may be cancelled outright ──────────────────
create or replace function public.guard_order_transition()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = old.status then
    return new;
  end if;

  -- Punch a backorder back into the pipeline (its salesman or an admin).
  if new.status = 'pending_approval' then
    if old.status <> 'backorder' then
      raise exception 'illegal order status transition: % -> pending_approval (order %)', old.status, old.id;
    end if;
    if public.auth_profile_role() = 'admin' or old.salesman_id = auth.uid() then
      return new;
    end if;
    raise exception 'only the salesman or an admin may punch this backorder (order %)', old.id;
  end if;

  -- Approval is admin-only and only from pending_approval.
  if new.status = 'approved' then
    if old.status <> 'pending_approval' then
      raise exception 'illegal order status transition: % -> approved (order %)', old.status, old.id;
    end if;
    if public.auth_profile_role() <> 'admin' then
      raise exception 'only admin may approve orders (order %)', old.id;
    end if;
    return new;
  end if;

  -- ready_to_bill arrives one way: a completed/partial pick on an approved order.
  if new.status = 'ready_to_bill' then
    if old.status = 'approved' then
      return new;
    end if;
    raise exception 'illegal order status transition: % -> ready_to_bill (order %)', old.status, old.id;
  end if;

  if old.status = 'pending_approval' and new.status = 'cancelled' then
    return new;
  end if;
  -- approved -> billed is the accountant OVERRIDE (bill without the godown step).
  if old.status = 'approved' and new.status in ('billed', 'cancelled') then
    return new;
  end if;
  if old.status = 'ready_to_bill' and new.status in ('billed', 'cancelled') then
    return new;
  end if;
  if old.status = 'billed' and new.status = 'cancelled' then
    return new;
  end if;
  -- A backorder (un-shipped remainder) may be cancelled outright — nothing was
  -- dispatched, so no billing/inventory effect. cancel_order gates WHO (admin).
  if old.status = 'backorder' and new.status = 'cancelled' then
    return new;
  end if;

  raise exception 'illegal order status transition: % -> % (order %)', old.status, new.status, old.id;
end;
$function$;

-- ── 2. cancel_order — status-gated, accountant limited to pending_approval ───
create or replace function public.cancel_order(p_order_id uuid, p_reason text default null::text)
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

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order % is already cancelled', p_order_id;
  end if;

  -- No edit-window timer. Cancel rights are purely status + role driven:
  --   salesman   → own order, only while pending_approval
  --   accountant → only pending_approval (+reason)
  --   admin      → any live state (+reason)
  if v_role = 'salesman' then
    if v_order.salesman_id <> v_caller then
      raise exception 'not your order';
    end if;
    if v_order.status <> 'pending_approval' then
      raise exception 'the order is past approval; ask the office to cancel it';
    end if;
  elsif v_role = 'accountant' then
    if v_order.status <> 'pending_approval' then
      raise exception 'only an admin may cancel an order past approval (status=%)', v_order.status;
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason is required for a cancellation';
    end if;
  elsif v_role = 'admin' then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason is required for a cancellation';
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
$function$;

-- ── 3. update_order_items — status-gated; post-approval edits are admin-only ─
create or replace function public.update_order_items(p_order_id uuid, p_notes text, p_items jsonb, p_reason text default null::text)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller       uuid := auth.uid();
  v_role         text := public.auth_profile_role();
  v_order        public.orders;
  v_item         jsonb;
  v_product      public.products;
  v_qty          integer;
  v_unit_price   integer;
  v_product_id   uuid;
  v_position     integer := 0;
  v_before       jsonb;
  v_after        jsonb;
  v_action       text;
  v_details      jsonb;
  v_pricing_mode text;
  c_price_ceiling constant integer := 100000000;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order % is cancelled and cannot be edited', p_order_id;
  end if;

  if p_items is null or jsonb_array_length(p_items) < 1 then
    raise exception 'order must retain at least one item — cancel it instead of emptying it';
  end if;

  -- No edit-window timer. Edit rights are purely status + role driven:
  --   salesman   → own order, only while pending_approval
  --   accountant → only pending_approval
  --   admin      → any live state; pending_approval is a normal edit, any later
  --                state is an after-lock override that requires a reason.
  if v_role = 'salesman' then
    if v_order.salesman_id <> v_caller then
      raise exception 'not your order';
    end if;
    if v_order.status <> 'pending_approval' then
      raise exception 'the order is past approval and can no longer be edited';
    end if;
    v_action := 'items_changed';
  elsif v_role = 'accountant' then
    if v_order.status <> 'pending_approval' then
      raise exception 'only an admin may edit an order past approval (status=%)', v_order.status;
    end if;
    v_action := 'items_changed';
  elsif v_role = 'admin' then
    if v_order.status = 'pending_approval' then
      v_action := 'items_changed';
    else
      v_action := 'edited_after_lock';
      if p_reason is null or btrim(p_reason) = '' then
        raise exception 'reason is required to edit an order past approval';
      end if;
    end if;
  else
    raise exception 'role % cannot edit orders', v_role;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) it
    join public.products p on p.id = (it->>'product_id')::uuid
    where p.brand_id <> v_order.brand_id
  ) then
    raise exception 'all items in an order must be the same brand';
  end if;

  select b.pricing_mode into v_pricing_mode from public.brands b where b.id = v_order.brand_id;

  select coalesce(jsonb_agg(
           jsonb_build_object('tally_name', p.tally_name, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)
           order by oi.position), '[]'::jsonb)
    into v_before
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  delete from public.order_items oi
  where oi.order_id = p_order_id
    and not exists (
      select 1 from jsonb_array_elements(p_items) it
      where (it->>'product_id')::uuid = oi.product_id
    );

  v_position := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::integer;

    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'invalid qty for item %', v_item;
    end if;

    if v_pricing_mode = 'manual' then
      v_unit_price := (v_item->>'unit_price_paise')::integer;
      if v_unit_price is null or v_unit_price <= 0 or v_unit_price > c_price_ceiling then
        raise exception 'invalid manual price for item %', v_product_id;
      end if;
    end if;

    if exists (select 1 from public.order_items where order_id = p_order_id and product_id = v_product_id) then
      if v_pricing_mode = 'manual' then
        update public.order_items
           set qty = v_qty,
               unit_price_paise = v_unit_price,
               line_total_paise = v_unit_price::bigint * v_qty,
               position = v_position
         where order_id = p_order_id and product_id = v_product_id;
      else
        update public.order_items
           set qty = v_qty,
               line_total_paise = unit_price_paise::bigint * v_qty,
               position = v_position
         where order_id = p_order_id and product_id = v_product_id;
      end if;
    else
      select * into v_product from public.products where id = v_product_id;
      if not found or not v_product.active then
        raise exception 'product % is not orderable', v_product_id;
      end if;

      if v_pricing_mode = 'manual' then
        insert into public.order_items (
          order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position
        ) values (
          p_order_id, v_product.id, v_product.name, v_unit_price, v_qty,
          v_unit_price::bigint * v_qty, v_position
        );
      else
        if v_product.price_paise is null then
          raise exception 'product % is not orderable', v_product_id;
        end if;
        insert into public.order_items (
          order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position
        ) values (
          p_order_id, v_product.id, v_product.name, v_product.price_paise, v_qty,
          v_product.price_paise::bigint * v_qty, v_position
        );
      end if;
    end if;

    v_position := v_position + 1;
  end loop;

  update public.orders set notes = coalesce(p_notes, notes) where id = p_order_id;

  select coalesce(jsonb_agg(
           jsonb_build_object('tally_name', p.tally_name, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)
           order by oi.position), '[]'::jsonb)
    into v_after
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  v_details := jsonb_build_object('before', v_before, 'after', v_after);
  if p_reason is not null and btrim(p_reason) <> '' then
    v_details := v_details || jsonb_build_object('reason', p_reason);
  end if;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, v_action, v_details);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;
