-- Fix: stock import hit statement_timeout (anon 3s / authenticated 8s). The
-- per-row loop did a full products seq-scan per row (no index on the case-
-- insensitive tally_name match) + an O(N^2) unmatched-array concat. Rewrite
-- import_stock + import_stock_agent to a single set-based UPDATE (one pass) and
-- add a functional index on lower(btrim(tally_name)). Return shape + gates
-- unchanged ({matched, unmatched}); matched = product rows updated.
-- Measured: 2000 rows 4331ms -> 18ms; 5000 rows -> 34ms. Applied 20260719194611.

create index if not exists products_tally_lower_idx
  on public.products (lower(btrim(tally_name)));

create or replace function public.import_stock(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_role text := public.auth_profile_role(); v_now timestamptz := now(); v_result jsonb;
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role <> 'admin' then raise exception 'only admin may import stock'; end if;
  with parsed as (
    select distinct on (lower(btrim(e->>'tally_name')))
           lower(btrim(e->>'tally_name')) as k, btrim(e->>'tally_name') as name, (e->>'stock_qty')::integer as qty
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as t(e)
    where btrim(e->>'tally_name') <> '' and (e->>'stock_qty') ~ '^-?[0-9]+$'
    order by lower(btrim(e->>'tally_name'))
  ),
  upd as (
    update public.products p set stock_qty = parsed.qty, stock_updated_at = v_now
    from parsed where lower(btrim(p.tally_name)) = parsed.k
    returning parsed.k
  )
  select jsonb_build_object(
    'matched', (select count(*) from upd),
    'unmatched', coalesce((select jsonb_agg(p2.name order by p2.name) from parsed p2 where p2.k not in (select k from upd)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

create or replace function public.import_stock_agent(p_secret text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_expected text; v_now timestamptz := now(); v_result jsonb;
begin
  select secret_hash into v_expected from public.agent_config where name = 'stock_push';
  if v_expected is null or p_secret is null or encode(digest(p_secret, 'sha256'), 'hex') <> v_expected then
    raise exception 'unauthorized';
  end if;
  with parsed as (
    select distinct on (lower(btrim(e->>'tally_name')))
           lower(btrim(e->>'tally_name')) as k, btrim(e->>'tally_name') as name, (e->>'stock_qty')::integer as qty
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as t(e)
    where btrim(e->>'tally_name') <> '' and (e->>'stock_qty') ~ '^-?[0-9]+$'
    order by lower(btrim(e->>'tally_name'))
  ),
  upd as (
    update public.products p set stock_qty = parsed.qty, stock_updated_at = v_now
    from parsed where lower(btrim(p.tally_name)) = parsed.k
    returning parsed.k
  )
  select jsonb_build_object(
    'matched', (select count(*) from upd),
    'unmatched', coalesce((select jsonb_agg(p2.name order by p2.name) from parsed p2 where p2.k not in (select k from upd)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;
