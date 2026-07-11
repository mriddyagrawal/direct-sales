-- Manual-brand DEFAULT price: server-side fallback (owner decision 2026-07-11).
--
-- Manual-pricing brands (LG) may now carry an OPTIONAL default price on
-- products.price_paise (the CHECK is null-or-positive, so a manual product may
-- hold one). The client pre-fills + seeds it into the cart, but the server is
-- authoritative either way: if a manual line ever arrives WITHOUT a price (e.g.
-- a new line added during an edit), fall back to the product's default.
--
-- Change is surgical — only the manual branch's unit-price assignment gains a
-- coalesce to v_product.price_paise. Fixed brands are UNTOUCHED (catalog price
-- snapshotted server-side, client price ignored — untamperable stays). The
-- existing validation (> 0, <= ceiling, reject-if-still-null) is unchanged, so a
-- manual product with neither an entry nor a default is still rejected.
--
-- NOTE on update_order_items: the manual price is validated at the TOP of the
-- item loop, BEFORE v_product is loaded for existing lines — so it coalesces
-- against a scoped subquery (select price_paise ... where id = v_product_id)
-- rather than v_product.price_paise, which would be stale there. submit_order
-- loads v_product before the price branch, so it uses v_product.price_paise
-- directly. Everything else in both functions is byte-identical to the prior
-- definitions.

CREATE OR REPLACE FUNCTION public.submit_order(p_id uuid, p_retailer_id uuid, p_notes text, p_items jsonb)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  select b.code, b.pricing_mode
    into v_brand_code, v_pricing_mode
  from public.brands b where b.id = v_brand_id;

  v_order_no  := nextval('public.order_no_seq');
  v_order_ref := 'ORD-' || v_brand_code || '-' || v_order_no;

  insert into public.orders (
    id, order_no, order_ref, retailer_id, salesman_id, brand_id, status, notes,
    total_paise, submitted_at, editable_until
  ) values (
    p_id, v_order_no, v_order_ref, p_retailer_id, v_caller, v_brand_id, 'pending_approval',
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
      v_unit_price := coalesce((v_item->>'unit_price_paise')::integer, v_product.price_paise);
      if v_unit_price is null or v_unit_price <= 0 or v_unit_price > c_price_ceiling then
        raise exception 'invalid manual price for item %', v_item->>'product_id';
      end if;
    else
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
$function$;

CREATE OR REPLACE FUNCTION public.update_order_items(p_order_id uuid, p_notes text, p_items jsonb, p_reason text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_role   text := public.auth_profile_role();
  v_order  public.orders;
  v_item jsonb; v_product public.products; v_qty integer; v_unit_price integer; v_product_id uuid;
  v_position integer := 0; v_before jsonb; v_after jsonb; v_action text; v_details jsonb; v_pricing_mode text;
  c_price_ceiling constant integer := 100000000;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if v_order.status = 'cancelled' then raise exception 'order % is cancelled and cannot be edited', p_order_id; end if;
  if p_items is null or jsonb_array_length(p_items) < 1 then raise exception 'order must retain at least one item — cancel it instead of emptying it'; end if;
  if v_role = 'salesman' then
    if v_order.salesman_id <> v_caller then raise exception 'not your order'; end if;
    if v_order.status <> 'pending_approval' then raise exception 'the order is past approval and can no longer be edited'; end if;
    v_action := 'items_changed';
  elsif v_role = 'accountant' then
    if v_order.status <> 'pending_approval' then raise exception 'only an admin may edit an order past approval (status=%)', v_order.status; end if;
    v_action := 'items_changed';
  elsif v_role = 'admin' then
    if v_order.status = 'pending_approval' then v_action := 'items_changed';
    else
      v_action := 'edited_after_lock';
      if p_reason is null or btrim(p_reason) = '' then raise exception 'reason is required to edit an order past approval'; end if;
    end if;
  else raise exception 'role % cannot edit orders', v_role; end if;

  if exists (select 1 from jsonb_array_elements(p_items) it join public.products p on p.id = (it->>'product_id')::uuid where p.brand_id <> v_order.brand_id) then
    raise exception 'all items in an order must be the same brand';
  end if;

  select b.pricing_mode into v_pricing_mode from public.brands b where b.id = v_order.brand_id;

  select coalesce(jsonb_agg(jsonb_build_object('tally_name', p.tally_name, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise) order by oi.position), '[]'::jsonb)
    into v_before from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = p_order_id;

  delete from public.order_items oi
  where oi.order_id = p_order_id and not exists (select 1 from jsonb_array_elements(p_items) it where (it->>'product_id')::uuid = oi.product_id);

  v_position := 0;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then raise exception 'invalid qty for item %', v_item; end if;
    if v_pricing_mode = 'manual' then
      v_unit_price := coalesce((v_item->>'unit_price_paise')::integer, (select price_paise from public.products where id = v_product_id));
      if v_unit_price is null or v_unit_price <= 0 or v_unit_price > c_price_ceiling then raise exception 'invalid manual price for item %', v_product_id; end if;
    end if;
    if exists (select 1 from public.order_items where order_id = p_order_id and product_id = v_product_id) then
      if v_pricing_mode = 'manual' then
        update public.order_items set qty = v_qty, unit_price_paise = v_unit_price, line_total_paise = v_unit_price::bigint * v_qty, position = v_position where order_id = p_order_id and product_id = v_product_id;
      else
        update public.order_items set qty = v_qty, line_total_paise = unit_price_paise::bigint * v_qty, position = v_position where order_id = p_order_id and product_id = v_product_id;
      end if;
    else
      select * into v_product from public.products where id = v_product_id;
      if not found or not v_product.active then raise exception 'product % is not orderable', v_product_id; end if;
      if v_pricing_mode = 'manual' then
        insert into public.order_items (order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position)
        values (p_order_id, v_product.id, v_product.name, v_unit_price, v_qty, v_unit_price::bigint * v_qty, v_position);
      else
        if v_product.price_paise is null then raise exception 'product % is not orderable', v_product_id; end if;
        insert into public.order_items (order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position)
        values (p_order_id, v_product.id, v_product.name, v_product.price_paise, v_qty, v_product.price_paise::bigint * v_qty, v_position);
      end if;
    end if;
    v_position := v_position + 1;
  end loop;

  update public.orders set notes = coalesce(p_notes, notes) where id = p_order_id;

  select coalesce(jsonb_agg(jsonb_build_object('tally_name', p.tally_name, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise) order by oi.position), '[]'::jsonb)
    into v_after from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = p_order_id;

  v_details := jsonb_build_object('before', v_before, 'after', v_after);
  if p_reason is not null and btrim(p_reason) <> '' then v_details := v_details || jsonb_build_object('reason', p_reason); end if;

  insert into public.order_events (order_id, actor_id, action, details) values (p_order_id, v_caller, v_action, v_details);

  select * into v_order from public.orders where id = p_order_id; return v_order;
end; $function$;
