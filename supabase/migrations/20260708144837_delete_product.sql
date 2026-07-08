-- Admin-only hard delete for a product, guarded so it can never orphan order
-- history: a product referenced by any order line is refused (deactivate it
-- instead). A never-ordered product (typo / test item) deletes cleanly, which
-- also frees its (brand_id, tally_name) so the same thing can be re-added.
create or replace function public.delete_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.auth_profile_role();
begin
  if v_role <> 'admin' then
    raise exception 'only admin may delete products';
  end if;

  if exists (select 1 from public.order_items where product_id = p_id) then
    raise exception 'this product has orders — deactivate it instead of deleting';
  end if;

  delete from public.products where id = p_id;
end;
$$;

grant execute on function public.delete_product(uuid) to authenticated;
