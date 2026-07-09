-- Godown needs to read products.tally_name to show the LG model on the pick
-- screen (order_items only snapshots product_name, not the model). The godown
-- had no products SELECT policy, so the products(tally_name) embed returned
-- null. Additive SELECT only; prices ride along in the row but the godown UI
-- never renders them (owner decision).
create policy products_select_godown
  on public.products
  for select
  to authenticated
  using (public.auth_profile_role() = 'godown');
