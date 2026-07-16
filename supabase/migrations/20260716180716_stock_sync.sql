-- Tally stock sync: two additive nullable columns on products + an admin-only
-- import RPC. stock_qty is a plain integer COUNT (never money/paise). Matches
-- globally on tally_name (one Tally company holds all brands). Updates ONLY the
-- two stock columns — never price/name/category/active, never inserts/deletes.
-- (products.updated_at is bumped by the table's touch_updated_at trigger, same
-- as every other write to the table; this RPC does not set it.)
alter table public.products add column stock_qty integer;           -- null = never synced
alter table public.products add column stock_updated_at timestamptz; -- per-row "as of"

create or replace function public.import_stock(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role text := public.auth_profile_role();
  v_row jsonb; v_name text; v_qty integer; v_hit integer;
  v_matched integer := 0; v_unmatched jsonb := '[]'::jsonb; v_now timestamptz := now();
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role <> 'admin' then raise exception 'only admin may import stock'; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := btrim(v_row->>'tally_name');
    if v_name is null or v_name = '' then continue; end if;
    if (v_row->>'stock_qty') !~ '^-?[0-9]+$' then continue; end if;   -- skip non-integer
    v_qty := (v_row->>'stock_qty')::integer;
    update public.products
       set stock_qty = v_qty, stock_updated_at = v_now
     where lower(btrim(tally_name)) = lower(v_name);                  -- global, case-insensitive
    get diagnostics v_hit = row_count;
    if v_hit > 0 then v_matched := v_matched + v_hit;
    else v_unmatched := v_unmatched || to_jsonb(v_name); end if;
  end loop;
  return jsonb_build_object('matched', v_matched, 'unmatched', v_unmatched);
end; $$;

grant execute on function public.import_stock(jsonb) to authenticated;
