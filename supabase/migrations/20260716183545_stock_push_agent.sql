-- Auto-push (Tally agent → app in one step). A secret-guarded, stock-ONLY write
-- path so the Windows extractor can submit stock without an admin login on the
-- VPS. The VPS holds only a random shared secret; that secret can do exactly one
-- thing — update stock counts (never read orders, never touch price/name). Same
-- update logic as import_stock; the difference is the gate (a hashed shared
-- secret vs an admin JWT). The manual admin "Update stock" button is unchanged.
-- Applied to prod as 20260716183545.

-- Locked secret store: RLS on, no policies, revoked from anon/authenticated — so
-- only a SECURITY DEFINER function (running as owner) can read the hash. Only the
-- SHA-256 hash of the secret is stored, never the secret itself.
create table if not exists public.agent_config (
  name        text primary key,
  secret_hash text not null,
  updated_at  timestamptz not null default now()
);
alter table public.agent_config enable row level security;
revoke all on public.agent_config from anon, authenticated;

-- The hash of the current stock-push secret (rotate by updating this row with a
-- new sha256 hex; the secret itself lives only on the VPS agent_config.ini).
insert into public.agent_config (name, secret_hash)
values ('stock_push', 'd33216470048ae9661ce4ea8f20109abda600ceadabaf43862875d8029859e65')
on conflict (name) do update set secret_hash = excluded.secret_hash, updated_at = now();

-- Secret-gated stock import. Bad/absent secret → raises 'unauthorized' (generic;
-- leaks nothing). On success, updates ONLY stock_qty + stock_updated_at, matched
-- globally + case-insensitively on tally_name; never inserts/deletes; returns
-- {matched, unmatched:[…]}. Exposed to anon but useless without the secret.
create or replace function public.import_stock_agent(p_secret text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_row jsonb; v_name text; v_qty integer; v_hit integer;
  v_matched integer := 0; v_unmatched jsonb := '[]'::jsonb; v_now timestamptz := now();
  v_expected text;
begin
  select secret_hash into v_expected from public.agent_config where name = 'stock_push';
  if v_expected is null or p_secret is null
     or encode(digest(p_secret, 'sha256'), 'hex') <> v_expected then
    raise exception 'unauthorized';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := btrim(v_row->>'tally_name');
    if v_name is null or v_name = '' then continue; end if;
    if (v_row->>'stock_qty') !~ '^-?[0-9]+$' then continue; end if;
    v_qty := (v_row->>'stock_qty')::integer;
    update public.products set stock_qty = v_qty, stock_updated_at = v_now
     where lower(btrim(tally_name)) = lower(v_name);
    get diagnostics v_hit = row_count;
    if v_hit > 0 then v_matched := v_matched + v_hit;
    else v_unmatched := v_unmatched || to_jsonb(v_name); end if;
  end loop;
  return jsonb_build_object('matched', v_matched, 'unmatched', v_unmatched);
end; $$;

revoke all on function public.import_stock_agent(text, jsonb) from public;
grant execute on function public.import_stock_agent(text, jsonb) to anon, authenticated;
