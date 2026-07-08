-- M5.5 Commit 1: make (brand_id, tally_name) the catalog key, swap the order
-- audit trail from the invented `sku` to `tally_name`, then drop `sku`.
--
-- Settles the SKU question (docs/catalog-admin-design.md, decision 1): the
-- import source is a Tally export, so the Tally stock-item name is the natural
-- key the file already carries. `sku` was a code we invented and nobody uses.
--
-- Ordering matters: recreate the one live function that reads `p.sku`
-- (update_order_items — plpgsql is late-bound, so it would only fail at call
-- time after the drop) BEFORE dropping the column, so the app never has a
-- window where a submitted edit hits a missing column. submit_order does NOT
-- reference sku (it snapshots product_name), so it is left untouched.
--
-- Old order_events keep their `sku` key; new ones carry `tally_name`. The
-- reader (src/lib/order-events.ts) tolerates both.

-- 1. Backfill (idempotent — already all-populated from 20260707091019, but a
--    NOT NULL alter needs a guaranteed-full column regardless of prior state).
update public.products set tally_name = name where tally_name is null;

-- 2. tally_name becomes the always-present key.
alter table public.products alter column tally_name set not null;

-- 3. The catalog key: unique within a brand (import/manual-add upsert target).
alter table public.products
  add constraint products_brand_tally_key unique (brand_id, tally_name);

-- 4. Recreate the sole live function that emits `sku` in its audit payload,
--    swapping both jsonb_build_object keys to tally_name. This is the 4-arg
--    version from 20260707071615 (update_order_items_reason) reproduced
--    verbatim except for the two 'sku'/p.sku -> 'tally_name'/p.tally_name
--    changes (marked below). Body is otherwise identical.
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
  v_caller     uuid := auth.uid();
  v_role       text := public.auth_profile_role();
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
  v_details    jsonb;
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
    v_action := case when v_editable then 'items_changed' else 'edited_after_lock' end;
    if v_action = 'edited_after_lock' and (p_reason is null or btrim(p_reason) = '') then
      raise exception 'reason is required to edit an order after its edit window has passed';
    end if;
  else
    raise exception 'role % cannot edit orders', v_role;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('tally_name', p.tally_name, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)  -- was 'sku', p.sku
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

    if exists (select 1 from public.order_items where order_id = p_order_id and product_id = v_product_id) then
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
           jsonb_build_object('tally_name', p.tally_name, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)  -- was 'sku', p.sku
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

-- 5. Drop the invented sku (also drops products_sku_key). No view/rule depends
--    on it (verified), and the only function that referenced it was recreated
--    above.
alter table public.products drop column sku;
