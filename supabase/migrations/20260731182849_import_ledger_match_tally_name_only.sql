-- APPLIED to prod 2026-07-31 (owner-approved in session). Recorded here after
-- the fact: it was applied through the MCP tool, which writes to the remote
-- project's migration table but leaves no file behind, so the repo could no
-- longer rebuild prod's schema.
--
-- Changes exactly one thing from 20260731003406_import_ledger_rpc.sql: how a
-- payload ledger is matched to an app retailer. Everything else is verbatim.

create or replace function public._apply_ledger(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_from  date        := (p_payload->>'window_from')::date;
  v_to    date        := (p_payload->>'window_to')::date;
  v_asof  timestamptz := coalesce((p_payload->>'as_of')::timestamptz, now());
  v_res   jsonb;
begin
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

  -- Match ONLY on tally_ledger_name. The fallback to the shop's display name was
  -- removed 2026-08-01 at the owner's instruction: a shop's app name is for
  -- humans and may be edited, so letting it silently carry the ledger link means
  -- a rename can re-point real money at the wrong shop. The link is now explicit
  -- and one-directional. A shop with no link is simply absent from the import -
  -- it reads "not in the last sync", never zero.
  --
  -- CONSEQUENCE, by design: a newly added shop syncs nothing until someone fills
  -- in its tally_ledger_name. Silence, not a wrong number.
  create temp table _r on commit drop as
  select id,
         lower(regexp_replace(btrim(tally_ledger_name), '\s+', ' ', 'g')) as k
  from public.retailers
  where active and nullif(btrim(tally_ledger_name), '') is not null;

  -- Ambiguity from EITHER side. A unique index now prevents the app-side case,
  -- but Tally's own uniqueness is case-sensitive (this company holds one shop's
  -- name in title case and the same name in full caps as two separate ledgers),
  -- so the payload side stands.
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
