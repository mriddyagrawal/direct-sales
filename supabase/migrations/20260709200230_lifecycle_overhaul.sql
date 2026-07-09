-- Order lifecycle overhaul (owner decision, 2026-07-10):
--   * EVERY order starts pending_approval — approval is universal, admin-only.
--   * 'submitted' status removed entirely.
--   * approve_order routes by brand: requires_scan=true (LG) → 'approved'
--     (awaits godown scan); false (fixed) → straight to 'ready_to_bill'.
--   * 'processed' → 'billed' (status value, event action). The processed_at/
--     processed_by columns and the process_order RPC name stay — internal
--     plumbing that never surfaces.
--   * brands.requires_approval → requires_scan: approval no longer varies by
--     brand, so the flag's only job is "needs the godown scan step". Price
--     (pricing_mode) and scan (requires_scan) are now independent axes.
--   * Salesman self-cancel = pending_approval in-window (owner decision;
--     mirrors the edit rule — approval beats the timer).

-- 0. Safety: this migration assumes no 'submitted' rows exist (verified live;
--    fail loudly rather than backfill blind if one appeared meanwhile).
do $$
begin
  if exists (select 1 from public.orders where status = 'submitted') then
    raise exception 'unexpected submitted orders present — backfill them first';
  end if;
end $$;

-- 1. The flag rename. RLS policies (orders/order_items/order_item_scans
--    godown selects) reference the column by attnum and follow automatically;
--    function bodies are text and are recreated below.
alter table public.brands rename column requires_approval to requires_scan;

-- 2. Backfill processed → billed. A raw UPDATE would trip the guard trigger
--    and the CHECK, so: drop CHECK → disable guard → update rows + events →
--    re-enable → add the new CHECK (all one transaction).
alter table public.orders drop constraint orders_status_check;
alter table public.orders disable trigger guard_order_transition;
update public.orders set status = 'billed' where status = 'processed';
update public.order_events set action = 'billed' where action = 'processed';
alter table public.orders enable trigger guard_order_transition;
alter table public.orders add constraint orders_status_check
  check (status in ('pending_approval', 'approved', 'ready_to_bill', 'billed', 'cancelled'));

-- 3. submit_order — every order lands in pending_approval. Identical to the
--    live order_ref_drop_year body except: status is constant, the
--    requires_approval read is gone.
create or replace function public.submit_order(p_id uuid, p_retailer_id uuid, p_notes text, p_items jsonb)
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
$$;

-- 4. approve_order — admin-only (unchanged), now routes by the brand:
--    requires_scan → 'approved' (godown next); else straight 'ready_to_bill'.
--    approved_at/by stamped and the 'approved' event logged in BOTH cases.
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
  v_requires_scan boolean;
  v_next   text;
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

  select b.requires_scan into v_requires_scan
  from public.brands b where b.id = v_order.brand_id;
  v_next := case when coalesce(v_requires_scan, false) then 'approved' else 'ready_to_bill' end;

  update public.orders
     set status = v_next, approved_at = now(), approved_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'approved', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

-- 5. guard_order_transition — the new machine. No 'submitted' anywhere.
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

  -- ready_to_bill arrives two ways: the godown completing a pick on a scan
  -- brand (approved →), or the admin approving a fixed brand (pending_approval
  -- →, no scan step).
  if new.status = 'ready_to_bill' then
    if old.status = 'approved' then
      if public.auth_profile_role() <> 'godown' then
        raise exception 'only godown may mark an order ready to bill (order %)', old.id;
      end if;
      return new;
    end if;
    if old.status = 'pending_approval' then
      if public.auth_profile_role() <> 'admin' then
        raise exception 'only admin may approve orders (order %)', old.id;
      end if;
      return new;
    end if;
    raise exception 'illegal order status transition: % -> ready_to_bill (order %)', old.status, old.id;
  end if;

  if old.status = 'pending_approval' and new.status = 'cancelled' then
    return new;
  end if;
  -- approved -> billed is the accountant OVERRIDE (bill an LG order without
  -- the godown step) — deliberately kept.
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
$$;

-- 6. process_order — billable set is (approved, ready_to_bill); writes
--    'billed'. Function name + processed_at/by columns kept (plumbing).
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
    raise exception 'only accountant/admin may bill orders';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'pending_approval' then
    raise exception 'order % must be approved before it can be billed', p_order_id;
  end if;
  if v_order.status not in ('approved', 'ready_to_bill') then
    raise exception 'order % is not billable (status=%)', p_order_id, v_order.status;
  end if;

  update public.orders
     set status = 'billed', processed_at = now(), processed_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'billed', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

-- 7. update_order_items — salesman-editable window is pending_approval only
--    now (there is no 'submitted'). Staff edit-with-reason after the window
--    unchanged. Everything else identical to the live lg_manual_approval body.
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

  v_editable := v_order.status = 'pending_approval' and v_order.editable_until > now();

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

-- 8. cancel_order — the salesman's self-cancel gate becomes pending_approval
--    in-window (owner decision; there is no 'submitted', and once approved
--    the order is out of his hands). Staff cancel-with-reason unchanged.
--    Scan rows are kept on cancel (serials_within_bill), unchanged.
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
  v_role     text := public.auth_profile_role();
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

  v_editable := v_order.status = 'pending_approval' and v_order.editable_until > now();

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
         cancelled_at = now(),
         cancelled_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'cancelled',
          case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

-- 9. submit_pick — flag rename only (requires_approval → requires_scan);
--    everything else byte-identical to the live serials_within_bill body.
create or replace function public.submit_pick(p_order_id uuid, p_scans jsonb)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := auth.uid();
  v_role    text := public.auth_profile_role();
  v_order   public.orders;
  v_requires_scan boolean;
  v_scan    jsonb;
  v_item_id uuid;
  v_raw     text;
  v_serial  text;
  v_dup     text;
  v_bad     record;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;
  if v_role <> 'godown' then
    raise exception 'only godown may submit a pick';
  end if;

  -- Lock the order row: two concurrent submits of the same order serialize
  -- here, and the second one fails the status assert instead of double-writing.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status <> 'approved' then
    raise exception 'order % is not awaiting pick (status=%)', p_order_id, v_order.status;
  end if;

  select b.requires_scan into v_requires_scan
  from public.brands b where b.id = v_order.brand_id;
  if not coalesce(v_requires_scan, false) then
    raise exception 'order % is not a scan-brand order — no pick step', p_order_id;
  end if;

  if p_scans is null or jsonb_array_length(p_scans) < 1 then
    raise exception 'no scans supplied';
  end if;

  -- No scan may reference a line that is not on this order.
  if exists (
    select 1 from jsonb_array_elements(p_scans) e
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (e->>'order_item_id')::uuid and oi.order_id = p_order_id
    )
  ) then
    raise exception 'scan references a line that is not on this order';
  end if;

  -- Full coverage: every line's scan count must equal its qty.
  select oi.product_name, oi.qty, coalesce(c.n, 0) as scanned
    into v_bad
  from public.order_items oi
  left join (
    select (e->>'order_item_id')::uuid as item_id, count(*) as n
    from jsonb_array_elements(p_scans) e
    group by 1
  ) c on c.item_id = oi.id
  where oi.order_id = p_order_id
    and oi.qty <> coalesce(c.n, 0)
  limit 1;
  if found then
    raise exception 'line "%" needs % serial(s), got %', v_bad.product_name, v_bad.qty, v_bad.scanned;
  end if;

  -- WITHIN-BILL uniqueness (the only uniqueness there is now): derive every
  -- cleaned serial server-side and reject the batch if any appears twice.
  select s.serial into v_dup
  from (
    select coalesce(substring(e->>'raw_scan' from '[0-9]{3}[A-Z]{4}[0-9]{6}'), btrim(e->>'raw_scan')) as serial
    from jsonb_array_elements(p_scans) e
  ) s
  group by s.serial
  having count(*) > 1
  limit 1;
  if found then
    raise exception 'serial % was scanned twice on this bill', v_dup;
  end if;

  -- Insert one row per unit. The serial is derived HERE, server-side: regex
  -- hit -> the clean 13-char serial; miss -> the trimmed raw string (manual
  -- entry). Any client-sent serial is ignored. A serial existing on ANOTHER
  -- order inserts fine now — cross-bill reuse is allowed by design.
  for v_scan in select * from jsonb_array_elements(p_scans)
  loop
    v_item_id := (v_scan->>'order_item_id')::uuid;
    v_raw     := v_scan->>'raw_scan';
    if v_raw is null or btrim(v_raw) = '' then
      raise exception 'empty scan supplied';
    end if;
    v_serial := coalesce(substring(v_raw from '[0-9]{3}[A-Z]{4}[0-9]{6}'), btrim(v_raw));

    insert into public.order_item_scans (order_item_id, raw_scan, serial, scanned_by)
    values (v_item_id, v_raw, v_serial, v_caller);
  end loop;

  -- Stamp + transition (guard backstops: approved -> ready_to_bill, godown only).
  update public.orders
     set status = 'ready_to_bill', picked_at = now(), picked_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'picked',
          jsonb_build_object('scan_count', jsonb_array_length(p_scans)));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;
