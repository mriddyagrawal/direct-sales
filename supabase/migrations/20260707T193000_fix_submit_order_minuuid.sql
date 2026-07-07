-- Phase 3a hotfix ㊱ (blocking): submit_order in 20260707T190000_multi_brand.sql
-- derived the order's brand with min(p.brand_id), but PostgreSQL has NO min()
-- aggregate for the uuid type — so the function crashed at call time and live
-- order submission went down on the shared DB. (plpgsql is late-bound, so the
-- create-or-replace succeeded; the error only surfaced on execution.)
--
-- Fix: array_agg(distinct p.brand_id) then [1]. Body otherwise identical to the
-- 190000 version. Same signature; still backward-compatible.
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
  v_caller      uuid := auth.uid();
  v_role        text := public.auth_profile_role();
  v_order       public.orders;
  v_item        jsonb;
  v_product     public.products;
  v_qty         integer;
  v_order_no    integer;
  v_order_ref   text;
  v_now         timestamptz := now();
  v_item_count  integer := 0;
  v_brand_ids   uuid[];
  v_brand_id    uuid;
  v_brand_code  text;
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

  -- One order = exactly one brand (D4 invariant), enforced server-side. uuid
  -- has no min() aggregate — use array_agg(distinct ...)[1] (㊱).
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

  select b.code into v_brand_code from public.brands b where b.id = v_brand_id;

  v_order_no  := nextval('public.order_no_seq');
  v_order_ref := 'ORD-' || v_brand_code || '-' || to_char(v_now at time zone 'Asia/Kolkata', 'YYYY') || '-' || v_order_no;

  insert into public.orders (
    id, order_no, order_ref, retailer_id, salesman_id, brand_id, status, notes,
    total_paise, submitted_at, editable_until
  ) values (
    p_id, v_order_no, v_order_ref, p_retailer_id, v_caller, v_brand_id, 'submitted',
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

    insert into public.order_items (
      order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position
    ) values (
      p_id, v_product.id, v_product.name, v_product.price_paise, v_qty,
      v_product.price_paise::bigint * v_qty, v_item_count
    );

    v_item_count := v_item_count + 1;
  end loop;

  select * into v_order from public.orders where id = p_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_id, v_caller, 'submitted',
          jsonb_build_object('item_count', v_item_count, 'total_paise', v_order.total_paise));

  return v_order;
end;
$$;

grant execute on function public.submit_order(uuid, uuid, text, jsonb) to authenticated;
