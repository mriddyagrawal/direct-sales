-- M1.5: security-definer RPCs — the only write paths for orders
-- Source of truth: docs/specs/data-model.md ("Write paths"), docs/specs/order-lifecycle.md
--
-- All four RPCs: security definer, explicit search_path, role/ownership/time checks
-- done inside the function body against auth.uid()/now() (never trust the client).

-- ---------------------------------------------------------------------------
-- submit_order: (client draft) -> submitted. Idempotent on p_id.
-- ---------------------------------------------------------------------------
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
  v_caller     uuid := auth.uid();
  v_role       text := public.current_role();
  v_order      public.orders;
  v_item       jsonb;
  v_product    public.products;
  v_qty        integer;
  v_order_no   integer;
  v_order_ref  text;
  v_now        timestamptz := now();
  v_item_count integer := 0;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  -- Idempotent retry: an existing id returns that order untouched, differing
  -- payload or not.
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

  v_order_no  := nextval('public.order_no_seq');
  v_order_ref := 'ORD-' || to_char(v_now at time zone 'Asia/Kolkata', 'YYYY') || '-' || v_order_no;

  insert into public.orders (
    id, order_no, order_ref, retailer_id, salesman_id, status, notes,
    total_paise, submitted_at, editable_until
  ) values (
    p_id, v_order_no, v_order_ref, p_retailer_id, v_caller, 'submitted',
    coalesce(p_notes, ''), 0, v_now, v_now + interval '2 hours'
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'invalid qty for item %', v_item;
    end if;

    select * into v_product from public.products p where p.id = (v_item->>'product_id')::uuid;

    if not found or not v_product.active or v_product.price_paise is null then
      raise exception 'product % is not orderable', v_item->>'product_id';
    end if;

    -- Snapshot name/price from the catalog inside this transaction — any
    -- client-sent price in v_item is ignored.
    insert into public.order_items (
      order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position
    ) values (
      p_id, v_product.id, v_product.name, v_product.price_paise, v_qty,
      v_product.price_paise::bigint * v_qty, v_item_count
    );

    v_item_count := v_item_count + 1;
  end loop;

  -- recompute_order_total has already synced total_paise by this point.
  select * into v_order from public.orders where id = p_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_id, v_caller, 'submitted',
          jsonb_build_object('item_count', v_item_count, 'total_paise', v_order.total_paise));

  return v_order;
end;
$$;

grant execute on function public.submit_order(uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- update_order_items: diff by product_id — survivors keep their original
-- snapshot (qty only changes), new lines snapshot at edit-time catalog price,
-- removed lines are deleted. Never delete-all-and-reinsert.
-- ---------------------------------------------------------------------------
create or replace function public.update_order_items(
  p_order_id uuid,
  p_notes    text,
  p_items    jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     uuid := auth.uid();
  v_role       text := public.current_role();
  v_order      public.orders;
  v_item       jsonb;
  v_product    public.products;
  v_qty        integer;
  v_product_id uuid;
  v_position   integer := 0;
  v_before     jsonb;
  v_after      jsonb;
  v_action     text;
  v_editable   boolean;
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

  v_editable := v_order.status = 'submitted' and v_order.editable_until > now();

  if v_role = 'salesman' then
    if v_order.salesman_id <> v_caller then
      raise exception 'not your order';
    end if;
    if not v_editable then
      raise exception 'edit window has passed';
    end if;
    v_action := 'items_changed';
  elsif v_role in ('accountant', 'admin') then
    -- Past the window (or already processed): the edit still lands, but the
    -- audit trail marks it as edited_after_lock.
    v_action := case when v_editable then 'items_changed' else 'edited_after_lock' end;
  else
    raise exception 'role % cannot edit orders', v_role;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('sku', p.sku, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)
           order by oi.position), '[]'::jsonb)
    into v_before
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  -- Removed lines: present in the order today, absent from the new payload.
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

    if exists (select 1 from public.order_items where order_id = p_order_id and product_id = v_product_id) then
      -- Survivor: qty/position/line_total change; product_name and
      -- unit_price_paise are untouched — the price at order time is the deal.
      update public.order_items
         set qty = v_qty,
             line_total_paise = unit_price_paise::bigint * v_qty,
             position = v_position
       where order_id = p_order_id and product_id = v_product_id;
    else
      select * into v_product from public.products where id = v_product_id;
      if not found or not v_product.active or v_product.price_paise is null then
        raise exception 'product % is not orderable', v_product_id;
      end if;

      insert into public.order_items (
        order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position
      ) values (
        p_order_id, v_product.id, v_product.name, v_product.price_paise, v_qty,
        v_product.price_paise::bigint * v_qty, v_position
      );
    end if;

    v_position := v_position + 1;
  end loop;

  update public.orders set notes = coalesce(p_notes, notes) where id = p_order_id;

  select coalesce(jsonb_agg(
           jsonb_build_object('sku', p.sku, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)
           order by oi.position), '[]'::jsonb)
    into v_after
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, v_action, jsonb_build_object('before', v_before, 'after', v_after));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

grant execute on function public.update_order_items(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_order: owning salesman while editable, or accountant/admin any time
-- (accountant/admin must supply a reason).
-- ---------------------------------------------------------------------------
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
  v_role     text := public.current_role();
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
         cancelled_at = now()
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'cancelled',
          case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

grant execute on function public.cancel_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- process_order: submitted -> processed. accountant/admin only, beats the
-- edit timer (locks the salesman out immediately).
-- ---------------------------------------------------------------------------
create or replace function public.process_order(
  p_order_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text := public.current_role();
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

  if v_order.status <> 'submitted' then
    raise exception 'order % is not submitted (status=%)', p_order_id, v_order.status;
  end if;

  update public.orders
     set status = 'processed',
         processed_at = now(),
         processed_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'processed', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

grant execute on function public.process_order(uuid) to authenticated;
