-- The one write path into the ledger. APPLIED to prod (ledger 20260731003406).
-- Tally is the only source; this function is the only door, which is why
-- retailer_ledger_entries has no write policy at all.

create or replace function public._apply_ledger(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_from  date        := (p_payload->>'window_from')::date;
  v_to    date        := (p_payload->>'window_to')::date;
  v_asof  timestamptz := coalesce((p_payload->>'as_of')::timestamptz, now());
  v_res   jsonb;
begin
  -- A payload that failed its own reconciliation never gets in. The extractor
  -- already proved sum(statement) = closing - opening per shop; if it could not,
  -- the numbers are not trustworthy and half-loading them is worse than nothing.
  if coalesce(p_payload->>'reconciled', 'false') <> 'true' then
    raise exception 'this export did not reconcile — refusing to import';
  end if;
  if v_from is null or v_to is null then
    raise exception 'payload must declare window_from and window_to';
  end if;

  create temp table _in on commit drop as
  select btrim(s->>'ledger') as ledger,
         lower(regexp_replace(btrim(s->>'ledger'), '\s+', ' ', 'g')) as k,
         nullif(btrim(coalesce(s->>'outstanding','')), '') as outstanding_raw,
         s->'entries' as entries
  from jsonb_array_elements(coalesce(p_payload->'shops', '[]'::jsonb)) s
  where btrim(coalesce(s->>'ledger','')) <> '';

  -- Match on the same normalised key the spec pins: the Tally override when set,
  -- otherwise the shop name, case-folded with internal whitespace collapsed.
  create temp table _r on commit drop as
  select id,
         lower(regexp_replace(btrim(coalesce(nullif(btrim(tally_ledger_name), ''), name)),
                              '\s+', ' ', 'g')) as k
  from public.retailers where active;

  -- Ambiguity from EITHER side: two app shops sharing a name, or two Tally
  -- ledgers normalising the same (Tally's uniqueness is case-sensitive, so one
  -- shop's name in title case and in full caps are two ledgers in this very
  -- company). Writing one balance to two shops counts the same money twice, so
  -- neither is written.
  create temp table _amb on commit drop as
  select k from _r  group by k having count(*) > 1
  union
  select k from _in group by k having count(*) > 1;

  create temp table _m on commit drop as
  select r.id as retailer_id, i.ledger, i.outstanding_raw, i.entries
  from _in i join _r r on r.k = i.k
  where i.k not in (select k from _amb);

  -- A malformed amount is rejected outright, never coerced: a silently-zeroed
  -- balance reads as "this shop is clear", the most dangerous wrong answer here.
  if exists (select 1 from _m
             where outstanding_raw is not null
               and outstanding_raw !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$') then
    raise exception 'payload contains a non-numeric outstanding value';
  end if;

  update public.retailers r
     set outstanding_paise = case when m.outstanding_raw is null then null
                                  else round(m.outstanding_raw::numeric * 100)::bigint end,
         balance_as_of     = v_asof
    from _m m
   where r.id = m.retailer_id;

  -- Replace exactly the window the payload DECLARES it covered — never a
  -- hard-coded span. This is what makes a voucher deleted in Tally disappear
  -- here, and what stops a short export (a year-end boundary, say) from wiping
  -- months it never contained.
  delete from public.retailer_ledger_entries e
   using _m m
   where e.retailer_id = m.retailer_id
     and e.entry_date between v_from and v_to;

  with ins as (
    insert into public.retailer_ledger_entries
      (retailer_id, entry_date, voucher_type, voucher_no, debit_paise, credit_paise)
    select m.retailer_id, (e->>'date')::date,
           coalesce(nullif(btrim(e->>'type'), ''), 'Unknown'),
           nullif(btrim(coalesce(e->>'no', '')), ''),
           round(coalesce(nullif(btrim(coalesce(e->>'debit','')),  '')::numeric, 0) * 100)::bigint,
           round(coalesce(nullif(btrim(coalesce(e->>'credit','')), '')::numeric, 0) * 100)::bigint
      from _m m, jsonb_array_elements(coalesce(m.entries, '[]'::jsonb)) e
     where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
       and (e->>'date')::date between v_from and v_to   -- outside the declared
    returning 1                                          -- window it could never
  )                                                      -- be replaced again
  select jsonb_build_object(
    'matched',          (select count(*) from _m),
    'entries_written',  (select count(*) from ins),
    'window',           jsonb_build_array(v_from, v_to),
    'as_of',            v_asof,
    'ambiguous',        coalesce((select jsonb_agg(distinct i.ledger)
                                    from _in i where i.k in (select k from _amb)), '[]'::jsonb),
    'unmatched_count',  (select count(*) from _in i
                          where i.k not in (select k from _r)
                            and i.k not in (select k from _amb)),
    'unmatched_sample', coalesce((select jsonb_agg(ledger order by ledger)
                                    from (select i.ledger from _in i
                                           where i.k not in (select k from _r)
                                             and i.k not in (select k from _amb)
                                           order by i.ledger limit 100) t), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

revoke all on function public._apply_ledger(jsonb) from public, anon, authenticated;

-- Admin path: the import wizard on the Retailers page.
create or replace function public.import_ledger(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.auth_profile_role() is null then raise exception 'not an active profile'; end if;
  if public.auth_profile_role() <> 'admin' then
    raise exception 'only admin may import the ledger';
  end if;
  return public._apply_ledger(p_payload);
end $$;

revoke all on function public.import_ledger(jsonb) from public, anon;
grant execute on function public.import_ledger(jsonb) to authenticated;

-- Agent path: the VPS pushing straight from ledger_sync.py, gated on a hashed
-- shared secret in agent_config (name='ledger_push') exactly like stock_push.
-- The row is intentionally NOT created here; until the owner inserts it this
-- function refuses everything, which is the correct default.
create or replace function public.import_ledger_agent(p_secret text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_expected text;
begin
  select secret_hash into v_expected from public.agent_config where name = 'ledger_push';
  if v_expected is null or p_secret is null
     or encode(digest(p_secret, 'sha256'), 'hex') <> v_expected then
    raise exception 'unauthorized';
  end if;
  return public._apply_ledger(p_payload);
end $$;

revoke all on function public.import_ledger_agent(text, jsonb) from public;
grant execute on function public.import_ledger_agent(text, jsonb) to anon, authenticated;
