-- Godown fulfilment + LG serial capture (commit 1: backend only).
-- Design: docs/godown-fulfilment-design.md. New mobile role 'godown' scans each
-- LG unit's serial barcode; submit_pick flips approved -> ready_to_bill and
-- hands the accountant structured serials. Fixed brands are untouched.

-- 1. Role check gains 'godown'.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'accountant', 'salesman', 'godown'));

-- 2. Status machine gains 'ready_to_bill'.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('submitted', 'pending_approval', 'approved', 'ready_to_bill', 'processed', 'cancelled'));

-- 3. Pick stamps (mirror processed_at/processed_by).
alter table public.orders add column picked_at timestamptz;
alter table public.orders add column picked_by uuid references public.profiles(id);

-- 4. One row per physical unit scanned. raw_scan is the exact scanner output
--    (never lossy); serial is the cleaned 13-char value Tally stores.
create table public.order_item_scans (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  raw_scan      text not null,
  serial        text not null,
  scanned_at    timestamptz not null default now(),
  scanned_by    uuid not null references public.profiles(id)
);

-- A physical unit sells once: global-unique on the cleaned serial. Cancelled
-- orders free their serials because cancel_order DELETES the order's scans
-- (owner decision: simpler than a cross-table partial index).
create unique index order_item_scans_serial_uq on public.order_item_scans(serial);
create index order_item_scans_item_idx on public.order_item_scans(order_item_id);

-- 5. guard_order_transition — add the godown edges; everything existing kept.
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

  -- Pick completion is godown-only and only from approved (mirrors approve).
  if new.status = 'ready_to_bill' then
    if old.status <> 'approved' then
      raise exception 'illegal order status transition: % -> ready_to_bill (order %)', old.status, old.id;
    end if;
    if public.auth_profile_role() <> 'godown' then
      raise exception 'only godown may mark an order ready to bill (order %)', old.id;
    end if;
    return new;
  end if;

  if old.status = 'submitted' and new.status in ('processed', 'cancelled') then
    return new;
  end if;
  if old.status = 'pending_approval' and new.status = 'cancelled' then
    return new;
  end if;
  -- approved -> processed is the accountant OVERRIDE (bill without the godown
  -- step, for exceptions) — deliberately kept alongside the godown path.
  if old.status = 'approved' and new.status in ('processed', 'cancelled') then
    return new;
  end if;
  if old.status = 'ready_to_bill' and new.status in ('processed', 'cancelled') then
    return new;
  end if;
  if old.status = 'processed' and new.status = 'cancelled' then
    return new;
  end if;

  raise exception 'illegal order status transition: % -> % (order %)', old.status, new.status, old.id;
end;
$$;

-- 6. process_order — also accept ready_to_bill (the normal LG bill path).
--    Rebuilt from the live lg_manual_approval body; only the source-status
--    check changes.
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
    raise exception 'only accountant/admin may process orders';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status = 'pending_approval' then
    raise exception 'order % must be approved before it can be processed', p_order_id;
  end if;
  if v_order.status not in ('submitted', 'approved', 'ready_to_bill') then
    raise exception 'order % is not processable (status=%)', p_order_id, v_order.status;
  end if;

  update public.orders
     set status = 'processed', processed_at = now(), processed_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'processed', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

-- 7. cancel_order — free the order's serials so a cancelled unit can be
--    re-sold. Rebuilt from the live orders_cancelled_by body; the only
--    addition is the scans delete.
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

  -- Free the serials: a cancelled unit goes back on the shelf and must be
  -- scannable on a future order (unique(serial) would otherwise block it).
  delete from public.order_item_scans s
  using public.order_items oi
  where s.order_item_id = oi.id
    and oi.order_id = p_order_id;

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

-- 8. submit_pick — the godown's single write path. Validates full coverage,
--    derives serials server-side (client-sent serials are ignored), inserts
--    the scans, stamps picked_at/by, and flips approved -> ready_to_bill.
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

  -- Insert one row per unit. The serial is derived HERE, server-side: regex
  -- hit -> the clean 13-char serial; miss -> the trimmed raw string (manual
  -- entry). Any client-sent serial is ignored. Row-at-a-time so a duplicate
  -- (unique index, incl. within-batch dupes) names the offending serial.
  for v_scan in select * from jsonb_array_elements(p_scans)
  loop
    v_item_id := (v_scan->>'order_item_id')::uuid;
    v_raw     := v_scan->>'raw_scan';
    if v_raw is null or btrim(v_raw) = '' then
      raise exception 'empty scan supplied';
    end if;
    v_serial := coalesce(substring(v_raw from '[0-9]{3}[A-Z]{4}[0-9]{6}'), btrim(v_raw));

    begin
      insert into public.order_item_scans (order_item_id, raw_scan, serial, scanned_by)
      values (v_item_id, v_raw, v_serial, v_caller);
    exception when unique_violation then
      raise exception 'serial % already recorded on another order', v_serial;
    end;
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

grant execute on function public.submit_pick(uuid, jsonb) to authenticated;

-- 9. RLS. order_item_scans: fail-closed like orders/order_items — SELECT only,
--    no client write grants (writes go through submit_pick, security definer).
revoke all on public.order_item_scans from anon, authenticated;
alter table public.order_item_scans enable row level security;
grant select on public.order_item_scans to authenticated;

create policy order_item_scans_select_staff on public.order_item_scans
  for select
  using (public.auth_profile_role() in ('accountant', 'admin'));

create policy order_item_scans_select_godown on public.order_item_scans
  for select
  using (
    public.auth_profile_role() = 'godown'
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_scans.order_item_id
        and o.status in ('approved', 'ready_to_bill')
    )
  );

-- Godown's read scope. NOTE: RLS applies INSIDE policy subqueries, so the
-- brands/retailers godown policies below are load-bearing — without them the
-- exists() on brands filters to nothing and the godown sees an empty queue.
create policy orders_select_godown on public.orders
  for select
  using (
    public.auth_profile_role() = 'godown'
    and status in ('approved', 'ready_to_bill')
    and exists (
      select 1 from public.brands b
      where b.id = orders.brand_id and b.requires_approval
    )
  );

create policy order_items_select_godown on public.order_items
  for select
  using (
    public.auth_profile_role() = 'godown'
    and exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.status in ('approved', 'ready_to_bill')
        and exists (
          select 1 from public.brands b
          where b.id = o.brand_id and b.requires_approval
        )
    )
  );

create policy brands_select_godown on public.brands
  for select
  using (public.auth_profile_role() = 'godown' and active);

create policy retailers_select_godown on public.retailers
  for select
  using (public.auth_profile_role() = 'godown' and active);

-- Staff (accountant/admin) orders/order_items selects have no status filter,
-- so ready_to_bill rows are already visible to them — no change needed there.
