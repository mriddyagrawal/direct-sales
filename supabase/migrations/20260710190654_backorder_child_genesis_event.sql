-- The backorder child was born with no history. Log a genesis event on the
-- CHILD linking back to its parent ("Backordered from {parent_ref}"), so its
-- HISTORY isn't blank until it's punched. Only submit_pick changes; everything
-- else in it is identical to the Stage-1 version.
create or replace function public.submit_pick(p_order_id uuid, p_lines jsonb)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller  uuid := auth.uid();
  v_role    text := public.auth_profile_role();
  v_order   public.orders;
  v_requires_scan boolean;
  v_brand_code    text;
  v_line    jsonb;
  v_item    public.order_items;
  v_scans   jsonb;
  v_picked  integer;
  v_raw     text;
  v_serial  text;
  v_dup     text;
  v_any_picked boolean := false;
  v_any_short  boolean := false;
  v_child_id  uuid;
  v_child_no  integer;
  v_child_ref text;
  v_now       timestamptz := now();
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_role = 'salesman' and v_order.salesman_id <> v_caller then
    raise exception 'you can only pick your own orders';
  end if;

  if v_order.status <> 'approved' then
    raise exception 'order % is not awaiting pick (status=%)', p_order_id, v_order.status;
  end if;

  select b.requires_scan, b.code into v_requires_scan, v_brand_code
  from public.brands b where b.id = v_order.brand_id;

  if p_lines is null or jsonb_array_length(p_lines) < 1 then
    raise exception 'no pick lines supplied';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(elem)
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (e.elem->>'order_item_id')::uuid and oi.order_id = p_order_id)
  ) then
    raise exception 'a pick line references an item not on this order';
  end if;

  if coalesce(v_requires_scan, false) then
    select s.serial into v_dup
    from (
      select coalesce(substring(sc.raw from '[0-9]{3}[A-Z]{4}[0-9]{6}'), btrim(sc.raw)) as serial
      from jsonb_array_elements(p_lines) as e(elem),
           jsonb_array_elements_text(coalesce(e.elem->'scans', '[]'::jsonb)) as sc(raw)
    ) s
    group by s.serial having count(*) > 1 limit 1;
    if found then
      raise exception 'serial % was scanned twice on this bill', v_dup;
    end if;
  end if;

  for v_item in select * from public.order_items where order_id = p_order_id order by position
  loop
    select e.elem into v_line
    from jsonb_array_elements(p_lines) as e(elem)
    where (e.elem->>'order_item_id')::uuid = v_item.id
    limit 1;

    v_scans := coalesce(v_line->'scans', '[]'::jsonb);
    if coalesce(v_requires_scan, false) then
      v_picked := jsonb_array_length(v_scans);
    else
      v_picked := coalesce((v_line->>'picked_qty')::integer, 0);
    end if;

    if v_picked < 0 or v_picked > v_item.qty then
      raise exception 'line "%": picked % is out of range 0..%', v_item.product_name, v_picked, v_item.qty;
    end if;

    if v_picked > 0 then v_any_picked := true; end if;
    if v_picked < v_item.qty then v_any_short := true; end if;

    update public.order_items set picked_qty = v_picked where id = v_item.id;

    if coalesce(v_requires_scan, false) and v_picked > 0 then
      for v_raw in select st.raw from jsonb_array_elements_text(v_scans) as st(raw)
      loop
        if v_raw is null or btrim(v_raw) = '' then
          raise exception 'empty scan supplied on line "%"', v_item.product_name;
        end if;
        v_serial := coalesce(substring(v_raw from '[0-9]{3}[A-Z]{4}[0-9]{6}'), btrim(v_raw));
        insert into public.order_item_scans (order_item_id, raw_scan, serial, scanned_by)
        values (v_item.id, v_raw, v_serial, v_caller);
      end loop;
    end if;
  end loop;

  if not v_any_picked then
    raise exception 'pick at least one unit to submit (order %)', p_order_id;
  end if;

  update public.orders
     set status = 'ready_to_bill', picked_at = v_now, picked_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'picked',
          jsonb_build_object(
            'lines', (select jsonb_agg(jsonb_build_object(
                        'name', oi.product_name, 'ordered', oi.qty, 'picked', oi.picked_qty)
                        order by oi.position)
                      from public.order_items oi where oi.order_id = p_order_id)));

  if v_any_short then
    v_child_no  := nextval('public.order_no_seq');
    v_child_ref := 'ORD-' || v_brand_code || '-' || v_child_no;
    v_child_id  := gen_random_uuid();

    insert into public.orders (
      id, order_no, order_ref, retailer_id, salesman_id, brand_id, status, notes,
      total_paise, submitted_at, editable_until, parent_order_id
    ) values (
      v_child_id, v_child_no, v_child_ref, v_order.retailer_id, v_order.salesman_id,
      v_order.brand_id, 'backorder', v_order.notes, 0, v_now, v_now, p_order_id
    );

    insert into public.order_items (order_id, product_id, product_name, unit_price_paise, qty, line_total_paise, position)
    select v_child_id, oi.product_id, oi.product_name, oi.unit_price_paise,
           (oi.qty - oi.picked_qty), oi.unit_price_paise::bigint * (oi.qty - oi.picked_qty), oi.position
    from public.order_items oi
    where oi.order_id = p_order_id and oi.picked_qty < oi.qty;

    -- Event on the PARENT (→ child) and a genesis event on the CHILD (← parent).
    insert into public.order_events (order_id, actor_id, action, details)
    values (p_order_id, v_caller, 'backordered',
            jsonb_build_object('child_order_id', v_child_id, 'child_ref', v_child_ref));

    insert into public.order_events (order_id, actor_id, action, details)
    values (v_child_id, v_caller, 'backordered',
            jsonb_build_object('parent_order_id', p_order_id, 'parent_ref', v_order.order_ref));
  end if;

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;
