-- Serials: within-bill unique only (owner decision). Returns / cancellations /
-- re-sales mean the same physical unit legitimately reappears on later bills,
-- and the app can't see those events yet — so the GLOBAL unique goes. What
-- stays: a serial can never appear twice on the SAME bill (client instant
-- reject + the explicit within-batch check below). Owner explicitly accepts
-- the silent cross-order double-scan risk this opens.

-- 1. Drop the global unique — this WAS the whole cross-bill behavior.
drop index if exists public.order_item_scans_serial_uq;

-- 2. cancel_order — stop deleting the order's scans on cancel. That delete
--    only existed to free serials for the global unique; without it a
--    cancelled bill keeps its scan record (better audit). Rebuilt from the
--    live godown_fulfilment body; the ONLY change is the removed delete.
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

-- 3. submit_pick — the cross-order unique_violation catch is dead with the
--    index gone; the within-bill guard becomes an explicit pre-insert batch
--    check that names the offending serial. NOTE: an order is picked exactly
--    once (approved -> ready_to_bill, double-pick rejected), so within-batch
--    IS within-bill today; if a re-pick/edit-scans flow ever lands, this
--    check must also consider the order's existing rows. Everything else is
--    byte-identical to the live godown_fulfilment body.
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
  v_requires_approval boolean;
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

  select b.requires_approval into v_requires_approval
  from public.brands b where b.id = v_order.brand_id;
  if not coalesce(v_requires_approval, false) then
    raise exception 'order % is not an approval-brand order — no pick step', p_order_id;
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
