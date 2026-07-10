-- Stage 1: fulfilment for ALL brands · brand-aware picking · partial → backorder.
-- All brands go approved → godown. Godown picks brand-aware (LG scans, Zeb/Lum
-- enter qty), partial allowed; a short pick splits the order — original ships
-- the picked qty, a new child `backorder` holds the remainder. `backorder`
-- re-enters via punch_order. Ordered line snapshots stay immutable.

-- ── Schema ──────────────────────────────────────────────────────────────
alter table public.order_items
  add column picked_qty integer,
  add constraint order_items_picked_qty_range
    check (picked_qty is null or (picked_qty >= 0 and picked_qty <= qty));

alter table public.orders
  add column parent_order_id uuid references public.orders(id);

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status = any (array['backorder','pending_approval','approved','ready_to_bill','billed','cancelled']));

-- ── Order total is now the SHIPPED total ────────────────────────────────
-- Σ(coalesce(picked_qty, qty) × unit_price). Pre-pick (picked_qty null) this
-- equals the old Σ(line_total_paise); once picked it is the shipped amount; a
-- backorder child (picked_qty null) computes its remainder total for free.
-- The immutable line snapshot (qty/unit_price/line_total) is never rewritten.
create or replace function public.recompute_order_total()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order_id uuid;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  update public.orders
     set total_paise = (
       select coalesce(sum(coalesce(picked_qty, qty)::bigint * unit_price_paise), 0)
       from public.order_items
       where order_id = v_order_id
     )
   where id = v_order_id;
  return null;
end;
$function$;

-- ── approve_order: EVERY brand → approved (godown fulfils all) ───────────
create or replace function public.approve_order(p_order_id uuid)
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

  -- All brands now go to the godown pick stage (was: fixed brands skipped to
  -- ready_to_bill). The scan-vs-qty difference lives inside the pick screen.
  update public.orders
     set status = 'approved', approved_at = now(), approved_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'approved', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;

-- ── guard_order_transition: +backorder→pending_approval, −pending→ready ──
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

  -- ready_to_bill now arrives ONE way: a completed/partial pick on an approved
  -- order (any role — submit_pick is the gatekeeper). The old fixed-brand
  -- pending_approval→ready_to_bill shortcut is gone (fixed brands pick too).
  if new.status = 'ready_to_bill' then
    if old.status = 'approved' then
      return new;
    end if;
    raise exception 'illegal order status transition: % -> ready_to_bill (order %)', old.status, old.id;
  end if;

  if old.status = 'pending_approval' and new.status = 'cancelled' then
    return new;
  end if;
  -- approved -> billed is the accountant OVERRIDE (bill without the godown
  -- step) — deliberately kept.
  if old.status = 'approved' and new.status in ('billed', 'cancelled') then
    return new;
  end if;
  if old.status = 'ready_to_bill' and new.status in ('billed', 'cancelled') then
    return new;
  end if;
  if old.status = 'billed' and new.status = 'cancelled' then
    return new;
  end if;

  raise exception 'illegal order status transition: % -> % (order %)', old.status, new.status, old.id;
end;
$function$;

-- ── update_order_items: allow editing a backorder before it is punched ──
create or replace function public.update_order_items(p_order_id uuid, p_notes text, p_items jsonb, p_reason text DEFAULT NULL::text)
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

  -- A backorder is a pre-punch draft: freely editable by its salesman or an
  -- admin (no window). Otherwise the normal pending_approval in-window rule.
  v_editable := (v_order.status = 'pending_approval' and v_order.editable_until > now())
                or v_order.status = 'backorder';

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

-- ── submit_pick: brand-aware + partial + splitting ──────────────────────
drop function if exists public.submit_pick(uuid, jsonb);

create function public.submit_pick(p_order_id uuid, p_lines jsonb)
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

  -- Every payload line must belong to this order.
  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(elem)
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (e.elem->>'order_item_id')::uuid and oi.order_id = p_order_id)
  ) then
    raise exception 'a pick line references an item not on this order';
  end if;

  -- Within-bill serial dedup (LG only), across every scan in the submission.
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

  -- Walk every ORDERED line; the payload line (if any) says how many were picked.
  for v_item in select * from public.order_items where order_id = p_order_id order by position
  loop
    select e.elem into v_line
    from jsonb_array_elements(p_lines) as e(elem)
    where (e.elem->>'order_item_id')::uuid = v_item.id
    limit 1;

    v_scans := coalesce(v_line->'scans', '[]'::jsonb);
    if coalesce(v_requires_scan, false) then
      v_picked := jsonb_array_length(v_scans);          -- LG: picked = serials scanned
    else
      v_picked := coalesce((v_line->>'picked_qty')::integer, 0); -- Zeb/Lum: client qty
    end if;

    if v_picked < 0 or v_picked > v_item.qty then
      raise exception 'line "%": picked % is out of range 0..%', v_item.product_name, v_picked, v_item.qty;
    end if;

    if v_picked > 0 then v_any_picked := true; end if;
    if v_picked < v_item.qty then v_any_short := true; end if;

    update public.order_items set picked_qty = v_picked where id = v_item.id;

    -- LG: record each picked unit's serial (server-side extraction).
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

  -- The original ships the picked qty (total_paise recomputed by the trigger).
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

  -- Split: a NEW backorder child (same salesman) holds the remainder.
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

    insert into public.order_events (order_id, actor_id, action, details)
    values (p_order_id, v_caller, 'backordered',
            jsonb_build_object('child_order_id', v_child_id, 'child_ref', v_child_ref));
  end if;

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;

-- ── punch_order: backorder → pending_approval (salesman-owner or admin) ──
create function public.punch_order(p_order_id uuid)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_caller uuid := auth.uid();
  v_role   text := public.auth_profile_role();
  v_order  public.orders;
  v_now    timestamptz := now();
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status <> 'backorder' then
    raise exception 'order % is not a backorder (status=%)', p_order_id, v_order.status;
  end if;
  if v_role <> 'admin' and v_order.salesman_id <> v_caller then
    raise exception 'only the salesman or an admin may punch this backorder';
  end if;

  update public.orders
     set status = 'pending_approval', submitted_at = v_now, editable_until = v_now + interval '2 hours'
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'submitted', jsonb_build_object('punched', true));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;

-- ── RLS: godown sees ALL-brand approved/ready_to_bill (was requires_scan) ─
drop policy if exists orders_select_godown on public.orders;
create policy orders_select_godown on public.orders
  for select
  using (auth_profile_role() = 'godown' and status = any (array['approved','ready_to_bill']));

drop policy if exists order_items_select_godown on public.order_items;
create policy order_items_select_godown on public.order_items
  for select
  using (auth_profile_role() = 'godown' and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.status = any (array['approved','ready_to_bill'])
  ));
