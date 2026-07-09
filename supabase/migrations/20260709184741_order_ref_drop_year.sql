-- Order refs drop the year segment (owner decision, 2026-07-10):
-- ORD-<BRAND>-<no> (e.g. ORD-LG-1014) instead of ORD-<BRAND>-<YYYY>-<no>.
-- Safe because order_no comes from the single global order_no_seq which
-- never resets — the number alone is unique across all brands and years;
-- the year segment carried no uniqueness. Nothing in the app parses the
-- ref (display-only, verified). Also backfills the existing refs.

-- 1. Generator: submit_order, identical except the v_order_ref line.
create or replace function public.submit_order(p_id uuid, p_retailer_id uuid, p_notes text, p_items jsonb)
returns public.orders
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  select b.code, b.pricing_mode, b.requires_approval
    into v_brand_code, v_pricing_mode, v_requires_approval
  from public.brands b where b.id = v_brand_id;

  v_status := case when v_requires_approval then 'pending_approval' else 'submitted' end;

  v_order_no  := nextval('public.order_no_seq');
  -- Year segment dropped (owner decision 2026-07-10): the global sequence
  -- alone keeps the ref unique.
  v_order_ref := 'ORD-' || v_brand_code || '-' || v_order_no;

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
      v_unit_price := (v_item->>'unit_price_paise')::integer;
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

-- 2. Backfill: strip the 4-digit year segment from existing refs.
-- Anchored so it only ever removes the year — brand stays, number stays.
update public.orders
set order_ref = regexp_replace(order_ref, '^(ORD-[A-Za-z]+)-[0-9]{4}-([0-9]+)$', '\1-\2')
where order_ref ~ '^ORD-[A-Za-z]+-[0-9]{4}-[0-9]+$';
