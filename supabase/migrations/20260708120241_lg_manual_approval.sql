-- Phase 3b Commit 1: manual-pricing brands (LG) + admin approval states.
--
-- Trust boundary relaxes ONLY for brands flagged pricing_mode='manual': for a
-- manual-brand line the RPC accepts the client-sent unit price (validate > 0
-- and <= a fat-finger ceiling; NO floor). Fixed brands (Zebronics, Luminous)
-- are byte-for-byte unchanged — catalog snapshot, client price ignored,
-- untamperable, land in 'submitted', unpriced products stay hidden (D2).
--
-- Backward-compatible + signature-stable: the deployed main app (fixed-brand
-- clients that send no per-line price) keeps working — the price key is
-- optional and read only for manual brands.

-- 1. Brand flags (independent; existing brands default fixed / no-approval).
alter table public.brands
  add column pricing_mode text not null default 'fixed'
    check (pricing_mode in ('fixed', 'manual'));
alter table public.brands
  add column requires_approval boolean not null default false;

-- 2. Widen the order status machine.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('submitted', 'pending_approval', 'approved', 'processed', 'cancelled'));

-- 3. Approval stamps.
alter table public.orders add column approved_at timestamptz;
alter table public.orders add column approved_by uuid references public.profiles(id);

-- 4. submit_order — manual per-line pricing + initial status from the brand.
--    Rebuilt from the live Phase 3a (array_agg) body; the ONLY additions are
--    the pricing-mode branch and the requires_approval initial status. Fixed
--    brands take the exact same path as before.
create or replace function public.submit_order(
  p_id          uuid,
  p_retailer_id uuid,
  p_notes       text,
  p_items       jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller           uuid := auth.uid();
  v_role             text := public.auth_profile_role();
  v_order            public.orders;
  v_item             jsonb;
  v_product          public.products;
  v_qty              integer;
  v_unit_price       integer;
  v_order_no         integer;
  v_order_ref        text;
  v_now              timestamptz := now();
  v_item_count       integer := 0;
  v_brand_ids        uuid[];
  v_brand_id         uuid;
  v_brand_code       text;
  v_pricing_mode     text;
  v_requires_approval boolean;
  v_status           text;
  -- Fat-finger ceiling for manually-entered prices: ₹10,00,000 per unit. No
  -- floor (the salesman's typed price is the deal). integer paise column.
  c_price_ceiling    constant integer := 100000000;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  select * into v_order from public.orders o where o.id = p_id;
  if found then
    return v_order;
  end if;

  if p_items is null or jsonb_array_length(p_items) < 1 then
    raise exception 'order must have at least one item';
  end if;

  if not exists (select 1 from public.retailers r where r.id = p_retailer_id) then
    raise exception 'retailer % does not exist', p_retailer_id;
  end if;

  -- One order = one brand (㊱: uuid has no min(); use array_agg(distinct)[1]).
  select array_agg(distinct p.brand_id)
    into v_brand_ids
  from public.products p
  where p.id in (select (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem);

  if coalesce(array_length(v_brand_ids, 1), 0) > 1 then
    raise exception 'all items in an order must be the same brand';
  end if;
  v_brand_id := v_brand_ids[1];
  if v_brand_id is null then
    raise exception 'product % is not orderable', (p_items->0->>'product_id');
  end if;

  select b.code, b.pricing_mode, b.requires_approval
    into v_brand_code, v_pricing_mode, v_requires_approval
  from public.brands b where b.id = v_brand_id;

  v_status := case when v_requires_approval then 'pending_approval' else 'submitted' end;

  v_order_no  := nextval('public.order_no_seq');
  v_order_ref := 'ORD-' || v_brand_code || '-' || to_char(v_now at time zone 'Asia/Kolkata', 'YYYY') || '-' || v_order_no;

  insert into public.orders (
    id, order_no, order_ref, retailer_id, salesman_id, brand_id, status, notes,
    total_paise, submitted_at, editable_until
  ) values (
    p_id, v_order_no, v_order_ref, p_retailer_id, v_caller, v_brand_id, v_status,
    coalesce(p_notes, ''), 0, v_now, v_now + interval '2 hours'
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'invalid qty for item %', v_item;
    end if;

    select * into v_product from public.products p where p.id = (v_item->>'product_id')::uuid;
    if not found or not v_product.active then
      raise exception 'product % is not orderable', v_item->>'product_id';
    end if;

    if v_pricing_mode = 'manual' then
      -- Trust the client price ONLY here. > 0, <= ceiling, no floor.
      v_unit_price := (v_item->>'unit_price_paise')::integer;
      if v_unit_price is null or v_unit_price <= 0 or v_unit_price > c_price_ceiling then
        raise exception 'invalid manual price for item %', v_item->>'product_id';
      end if;
    else
      -- Fixed brand: snapshot from catalog, ignore any client-sent price.
      if v_product.price_paise is null then
        raise exception 'product % is not orderable', v_item->>'product_id';
      end if;
      v_unit_price := v_product.price_paise;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position
    ) values (
      p_id, v_product.id, v_product.name, v_unit_price, v_qty,
      v_unit_price::bigint * v_qty, v_item_count
    );

    v_item_count := v_item_count + 1;
  end loop;

  select * into v_order from public.orders where id = p_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_id, v_caller, 'submitted',
          jsonb_build_object('item_count', v_item_count, 'total_paise', v_order.total_paise)
          || case when v_pricing_mode = 'manual'
                  then jsonb_build_object('manual_priced', true) else '{}'::jsonb end);

  return v_order;
end;
$$;

grant execute on function public.submit_order(uuid, uuid, text, jsonb) to authenticated;

-- 5. update_order_items — allow editing a manual line's price within the
--    window; fixed lines keep their catalog snapshot. Rebuilt from the live
--    Phase 3a 4-arg p_reason body (tally_name audit key ㉞, reason-after-lock
--    ㉘, brand guard) — additions marked.
create or replace function public.update_order_items(
  p_order_id uuid,
  p_notes    text,
  p_items    jsonb,
  p_reason   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  v_editable     boolean;
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

  -- A pending_approval order stays salesman-editable within the window
  -- (approval beats the timer, exactly like submitted).
  v_editable := v_order.status in ('submitted', 'pending_approval') and v_order.editable_until > now();

  if v_role = 'salesman' then
    if v_order.salesman_id <> v_caller then
      raise exception 'not your order';
    end if;
    if not v_editable then
      raise exception 'edit window has passed';
    end if;
    v_action := 'items_changed';
  elsif v_role in ('accountant', 'admin') then
    v_action := case when v_editable then 'items_changed' else 'edited_after_lock' end;
    if v_action = 'edited_after_lock' and (p_reason is null or btrim(p_reason) = '') then
      raise exception 'reason is required to edit an order after its edit window has passed';
    end if;
  else
    raise exception 'role % cannot edit orders', v_role;
  end if;

  -- Brand guard: no line may introduce a product from another brand.
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
        -- manual survivor: the salesman may correct the entered price in-window
        update public.order_items
           set qty = v_qty,
               unit_price_paise = v_unit_price,
               line_total_paise = v_unit_price::bigint * v_qty,
               position = v_position
         where order_id = p_order_id and product_id = v_product_id;
      else
        -- fixed survivor: price is the immutable deal — qty/position only
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
$$;

grant execute on function public.update_order_items(uuid, text, jsonb, text) to authenticated;

-- 6. approve_order — admin-only, pending_approval -> approved, beats the timer.
create or replace function public.approve_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  update public.orders
     set status = 'approved', approved_at = now(), approved_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'approved', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

grant execute on function public.approve_order(uuid) to authenticated;

-- 7. process_order — accept 'submitted' (fixed) or 'approved' (approval brands);
--    reject 'pending_approval' with a clear message.
create or replace function public.process_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text := public.auth_profile_role();
  v_order  public.orders;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  if v_role not in ('accountant', 'admin') then
    raise exception 'only accountant/admin may process orders';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'pending_approval' then
    raise exception 'order % must be approved before it can be processed', p_order_id;
  end if;
  if v_order.status not in ('submitted', 'approved') then
    raise exception 'order % is not processable (status=%)', p_order_id, v_order.status;
  end if;

  update public.orders
     set status = 'processed', processed_at = now(), processed_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'processed', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

grant execute on function public.process_order(uuid) to authenticated;

-- 8. guard_order_transition — add the approval edges; →approved is admin-only
--    and only from pending_approval (backstops approve_order's own check).
create or replace function public.guard_order_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status then
    return new;
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

  if old.status = 'submitted' and new.status in ('processed', 'cancelled') then
    return new;
  end if;
  if old.status = 'pending_approval' and new.status = 'cancelled' then
    return new;
  end if;
  if old.status = 'approved' and new.status in ('processed', 'cancelled') then
    return new;
  end if;
  if old.status = 'processed' and new.status = 'cancelled' then
    return new;
  end if;

  raise exception 'illegal order status transition: % -> % (order %)', old.status, new.status, old.id;
end;
$$;

-- 9. products_select_salesman — manual-brand products are visible while
--    unpriced; fixed-brand NULL price stays hidden (D2).
alter policy products_select_salesman on public.products
  using (
    (public.auth_profile_role() = 'salesman')
    and active
    and (
      price_paise is not null
      or (select b.pricing_mode from public.brands b where b.id = products.brand_id) = 'manual'
    )
  );
