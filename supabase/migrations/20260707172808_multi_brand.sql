-- Phase 3a Commit 1: brand as a first-class order attribute + single-brand
-- guard + brand-coded order ref. Fixed-price brands only — NO pricing_mode /
-- manual pricing / approval (that's Phase 3b).
--
-- Backward-compatible on the shared live DB: the RPC signatures are UNCHANGED
-- (brand_id is derived server-side from the order's items), so the currently-
-- deployed `main` client — which sends no brand — keeps submitting/editing.
-- Additive columns + ORD-ZEB-… refs only; historical refs are left immutable.

-- 1. brands.code — short stable token for the ref (Option A: one global
--    order_no_seq, brand code is context). Backfill the sole existing brand.
alter table public.brands add column code text;
update public.brands set code = 'ZEB' where name = 'Zebronics';
-- NOT NULL is the safety net: any brand added later without a code fails loudly
-- (a code is required to build the ref).
alter table public.brands alter column code set not null;
alter table public.brands add constraint brands_code_key unique (code);

-- 2. orders.brand_id — explicit, not just derivable. Backfill from each order's
--    items (all existing = Zebronics; verified 0 zero-item / 0 mixed-brand).
alter table public.orders add column brand_id uuid;
update public.orders o
set brand_id = (
  select p.brand_id
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = o.id
  limit 1
);
alter table public.orders alter column brand_id set not null;
alter table public.orders
  add constraint orders_brand_id_fkey foreign key (brand_id) references public.brands(id);

-- 3. submit_order — SAME signature. Derive the single brand from the lines,
--    reject a mixed-brand order, set orders.brand_id, and prefix the ref with
--    the brand code.
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
  v_brand_id    uuid;
  v_brand_count integer;
  v_brand_code  text;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;

  -- Idempotent retry: an existing id returns that order untouched.
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

  -- One order = exactly one brand (D4 invariant), enforced server-side. Derive
  -- the brand from the referenced products; reject a mixed-brand order. A
  -- product_id that doesn't exist contributes nothing here and is caught by the
  -- per-line 'not orderable' check in the loop below.
  select count(distinct p.brand_id), min(p.brand_id)
    into v_brand_count, v_brand_id
  from public.products p
  where p.id in (select (elem->>'product_id')::uuid from jsonb_array_elements(p_items) elem);

  if v_brand_count > 1 then
    raise exception 'all items in an order must be the same brand';
  end if;
  if v_brand_id is null then
    -- No referenced product exists at all — surface the precise per-line error.
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

-- 4. update_order_items — SAME 4-arg p_reason body (copied verbatim from the
--    live M5.5 version: tally_name audit key ㉞, mandatory-p_reason-after-lock
--    guard ㉘) with ONE addition: a brand guard so an edit can't introduce a
--    line from a different brand than orders.brand_id.
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

  -- Brand guard (Phase 3a): every proposed line must belong to this order's
  -- brand — an edit can't turn a single-brand order into a mixed-brand one.
  if exists (
    select 1 from jsonb_array_elements(p_items) it
    join public.products p on p.id = (it->>'product_id')::uuid
    where p.brand_id <> v_order.brand_id
  ) then
    raise exception 'all items in an order must be the same brand';
  end if;

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

grant execute on function public.update_order_items(uuid, text, jsonb, text) to authenticated;
