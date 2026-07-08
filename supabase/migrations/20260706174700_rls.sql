-- M1.6: RLS — enable on every table, matching the matrix in
-- docs/specs/roles-and-permissions.md exactly. Default deny everywhere;
-- orders/order_items/order_events get NO client write grants at all
-- (writes are RPC-only, security definer, bypassing RLS + grants).
--
-- Supabase's default privilege template grants full CRUD on new public
-- tables to anon/authenticated; revoke that first so "RLS enabled + no
-- policy" and "no grant at all" both fail closed together, not just RLS
-- alone. anon gets nothing anywhere — this app has no public surface,
-- every screen requires an authenticated staff login (D3).

revoke all on public.profiles, public.brands, public.products, public.retailers,
  public.orders, public.order_items, public.order_events
  from anon, authenticated;

alter table public.profiles     enable row level security;
alter table public.brands       enable row level security;
alter table public.products     enable row level security;
alter table public.retailers    enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.order_events enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: SELECT all (any active staff member; names appear on orders).
-- UPDATE: salesman may touch only their own row, and role/active are pinned
-- to their pre-update values (a self-service role change would be a
-- privilege escalation); admin may update any row/column.
-- ---------------------------------------------------------------------------
grant select, update on public.profiles to authenticated;

create policy profiles_select_active on public.profiles
  for select
  using (public.current_role() is not null);

create policy profiles_update_self on public.profiles
  for update
  using (id = auth.uid() and public.current_role() = 'salesman')
  with check (
    id = auth.uid()
    and role   = (select p.role   from public.profiles p where p.id = auth.uid())
    and active = (select p.active from public.profiles p where p.id = auth.uid())
  );

create policy profiles_update_admin on public.profiles
  for update
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
grant select, insert, update on public.brands to authenticated;

create policy brands_select_salesman on public.brands
  for select
  using (public.current_role() = 'salesman' and active);

create policy brands_select_staff on public.brands
  for select
  using (public.current_role() in ('accountant', 'admin'));

create policy brands_admin_insert on public.brands
  for insert
  with check (public.current_role() = 'admin');

create policy brands_admin_update on public.brands
  for update
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---------------------------------------------------------------------------
-- products: unpriced/inactive rows are invisible to salesmen at the DB level
-- (D2) — not a UI filter.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.products to authenticated;

create policy products_select_salesman on public.products
  for select
  using (public.current_role() = 'salesman' and active and price_paise is not null);

create policy products_select_staff on public.products
  for select
  using (public.current_role() in ('accountant', 'admin'));

create policy products_staff_update on public.products
  for update
  using (public.current_role() in ('accountant', 'admin'))
  with check (public.current_role() in ('accountant', 'admin'));

create policy products_admin_insert on public.products
  for insert
  with check (public.current_role() = 'admin');

-- ---------------------------------------------------------------------------
-- retailers: salesman quick-add is forced unverified and self-attributed.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.retailers to authenticated;

create policy retailers_select_salesman on public.retailers
  for select
  using (public.current_role() = 'salesman' and active);

create policy retailers_select_staff on public.retailers
  for select
  using (public.current_role() in ('accountant', 'admin'));

create policy retailers_insert_salesman on public.retailers
  for insert
  with check (
    public.current_role() = 'salesman'
    and verified = false
    and created_by = auth.uid()
  );

create policy retailers_staff_insert on public.retailers
  for insert
  with check (public.current_role() in ('accountant', 'admin'));

create policy retailers_staff_update on public.retailers
  for update
  using (public.current_role() in ('accountant', 'admin'))
  with check (public.current_role() in ('accountant', 'admin'));

-- ---------------------------------------------------------------------------
-- orders / order_items / order_events: SELECT only. Every write (insert,
-- status change, item edit, cancellation) goes through the security-definer
-- RPCs in the previous migration, which run as the function owner and so
-- bypass both these grants and these policies entirely. No INSERT/UPDATE
-- grant is given here on purpose — RLS + absent grant = denied.
-- ---------------------------------------------------------------------------
grant select on public.orders, public.order_items, public.order_events to authenticated;

create policy orders_select_own on public.orders
  for select
  using (public.current_role() = 'salesman' and salesman_id = auth.uid());

create policy orders_select_staff on public.orders
  for select
  using (public.current_role() in ('accountant', 'admin'));

create policy order_items_select_own on public.order_items
  for select
  using (
    public.current_role() = 'salesman'
    and exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.salesman_id = auth.uid()
    )
  );

create policy order_items_select_staff on public.order_items
  for select
  using (public.current_role() in ('accountant', 'admin'));

create policy order_events_select_own on public.order_events
  for select
  using (
    public.current_role() = 'salesman'
    and exists (
      select 1 from public.orders o
      where o.id = order_events.order_id and o.salesman_id = auth.uid()
    )
  );

create policy order_events_select_staff on public.order_events
  for select
  using (public.current_role() in ('accountant', 'admin'));
