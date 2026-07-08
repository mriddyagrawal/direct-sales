-- M5.1: update_order_items gains p_reason (review flag ㉘). The M5 builder
-- prompt assumed the RPC already enforced "a post-lock edit requires a
-- reason" (accountant-dashboard.md's acceptance criterion #3) — it didn't
-- have a reason parameter at all. Mandatory only for edited_after_lock (an
-- accountant/admin editing past the window); an in-window items_changed
-- edit (salesman or staff) carries no reason, matching order-lifecycle.md's
-- event catalog.
--
-- Signature change (adds a 4th param) creates a new overload rather than
-- replacing the 3-arg version — drop that one explicitly first.

drop function public.update_order_items(uuid, text, jsonb);

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
           jsonb_build_object('sku', p.sku, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)
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
           jsonb_build_object('sku', p.sku, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise)
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
