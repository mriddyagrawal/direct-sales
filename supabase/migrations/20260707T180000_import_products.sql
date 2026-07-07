-- M5.5 Commit 4: atomic, admin-only bulk upsert for the Excel import wizard.
--
-- The client validates + normalizes rows in the preview (effective tally_name,
-- normalized category, price parsed to paise) and sends only the VALID rows.
-- This function applies them in a single transaction (all-or-nothing — a bad
-- file can't half-corrupt the catalog) and is idempotent: re-running the same
-- file upserts on (brand_id, tally_name), so every row comes back as Updated,
-- zero duplicates. It NEVER deletes: products absent from the file are left
-- untouched (the wizard reports them separately).
--
-- security definer + explicit admin check (defense in depth beyond the
-- admin-only Import button) and the added/updated split via the xmax=0 trick
-- (on INSERT xmax is 0; on the ON CONFLICT UPDATE path it is the current txid).
create or replace function public.import_products(p_brand_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role     text := public.auth_profile_role();
  v_row      jsonb;
  v_added    integer := 0;
  v_updated  integer := 0;
  v_inserted boolean;
begin
  if v_role is null then
    raise exception 'not an active profile';
  end if;
  if v_role <> 'admin' then
    raise exception 'only admin may import products';
  end if;
  if not exists (select 1 from public.brands where id = p_brand_id) then
    raise exception 'brand % does not exist', p_brand_id;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    insert into public.products (brand_id, category, name, tally_name, price_paise, active)
    values (
      p_brand_id,
      v_row->>'category',
      v_row->>'name',
      v_row->>'tally_name',
      case when v_row->>'price_paise' is null then null else (v_row->>'price_paise')::integer end,
      coalesce((v_row->>'active')::boolean, true)
    )
    on conflict (brand_id, tally_name) do update
      set category    = excluded.category,
          name        = excluded.name,
          price_paise = excluded.price_paise,
          active      = excluded.active,
          updated_at  = now()
    returning (xmax = 0) into v_inserted;

    if v_inserted then
      v_added := v_added + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

grant execute on function public.import_products(uuid, jsonb) to authenticated;
