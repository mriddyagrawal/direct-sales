-- Owner decision (2026-07-11, explicit sign-off in session): the salesman DOES
-- see the serials on his own orders — the revamp mockup showed them and the
-- owner confirmed. Supersedes the earlier "serials are staff-only" call (the
-- orders-ui spec §3 note anticipated exactly this flip needing exactly this
-- policy). SELECT-only, scoped to his own orders' lines; writes stay RPC-only.
create policy order_item_scans_select_salesman on public.order_item_scans
  for select
  using (
    public.auth_profile_role() = 'salesman'
    and exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_scans.order_item_id
        and o.salesman_id = auth.uid()
    )
  );
