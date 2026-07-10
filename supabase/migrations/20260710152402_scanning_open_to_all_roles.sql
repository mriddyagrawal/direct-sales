-- Open scanning beyond godown: admin/accountant/salesman may all scan an
-- approved LG order's serials. submit_pick becomes the gatekeeper (active
-- profile + salesman-own scope); the transition guard drops its godown-only
-- check on the approved -> ready_to_bill edge. No new columns, no RLS change,
-- every other guard byte-identical.

create or replace function public.submit_pick(p_order_id uuid, p_scans jsonb)
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
  -- Scanning is open to every active role now (admin/accountant/salesman/
  -- godown). The v_role is null check above already rejects inactive/no
  -- profile; the salesman-ownership scope below restricts a salesman to his
  -- own orders (defense-in-depth for this SECURITY DEFINER RPC).

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_role = 'salesman' and v_order.salesman_id <> v_caller then
    raise exception 'you can only scan your own orders';
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

  if exists (
    select 1 from jsonb_array_elements(p_scans) e
    where not exists (
      select 1 from public.order_items oi
      where oi.id = (e->>'order_item_id')::uuid and oi.order_id = p_order_id
    )
  ) then
    raise exception 'scan references a line that is not on this order';
  end if;

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

  update public.orders
     set status = 'ready_to_bill', picked_at = now(), picked_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'picked',
          jsonb_build_object('scan_count', jsonb_array_length(p_scans)));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$function$;

create or replace function public.guard_order_transition()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
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

  -- ready_to_bill arrives two ways: a completed pick on a scan brand
  -- (approved →), or the admin approving a fixed brand (pending_approval →,
  -- no scan step).
  if new.status = 'ready_to_bill' then
    if old.status = 'approved' then
      -- Scanning is open to any role now — submit_pick is the gatekeeper
      -- (active profile + salesman-own scope). No role check on this edge.
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
$function$;
