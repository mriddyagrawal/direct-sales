-- M1.8: rename current_role() -> auth_profile_role() (owner directive, Mridul, 2026-07-06)
--
-- current_role collides with a PostgreSQL reserved/SQL-standard keyword:
-- `select current_role()` unqualified is a hard syntax error (42601), and the
-- bare identifier `current_role` (no parens) silently resolves to the
-- Postgres *session* role, not our helper — a real footgun for any future
-- unqualified call site. Every existing call site already uses the qualified
-- public.current_role() form (nothing is broken today), but per the owner's
-- direction we rename before more policies/RPCs accrete on the risky name.
--
-- ALTER FUNCTION ... RENAME does not break the already-applied RLS policies
-- from 20260706T150500 — their compiled USING/WITH CHECK expressions are
-- bound to the function's OID, not its name, so they keep working unchanged
-- under the new name. Only the four RPC bodies contain the OLD name as
-- literal PL/pgSQL source text and must be recreated to call the new name.
-- CREATE OR REPLACE preserves each RPC's OID/grants since the signature is
-- unchanged — no re-GRANT needed.

alter function public.current_role() rename to auth_profile_role;

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
  v_caller     uuid := auth.uid();
  v_role       text := public.auth_profile_role();
  v_order      public.orders;
  v_item       jsonb;
  v_product    public.products;
  v_qty        integer;
  v_order_no   integer;
  v_order_ref  text;
  v_now        timestamptz := now();
  v_item_count integer := 0;
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

  v_order_no  := nextval('public.order_no_seq');
  v_order_ref := 'ORD-' || to_char(v_now at time zone 'Asia/Kolkata', 'YYYY') || '-' || v_order_no;

  insert into public.orders (
    id, order_no, order_ref, retailer_id, salesman_id, status, notes,
    total_paise, submitted_at, editable_until
  ) values (
    p_id, v_order_no, v_order_ref, p_retailer_id, v_caller, 'submitted',
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

create or replace function public.update_order_items(
  p_order_id uuid,
  p_notes    text,
  p_items    jsonb
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

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, v_action, jsonb_build_object('before', v_before, 'after', v_after));

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

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
         cancelled_at = now()
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'cancelled',
          case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

create or replace function public.process_order(
  p_order_id uuid
)
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

  if v_order.status <> 'submitted' then
    raise exception 'order % is not submitted (status=%)', p_order_id, v_order.status;
  end if;

  update public.orders
     set status = 'processed',
         processed_at = now(),
         processed_by = v_caller
   where id = p_order_id;

  insert into public.order_events (order_id, actor_id, action, details)
  values (p_order_id, v_caller, 'processed', '{}'::jsonb);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;
