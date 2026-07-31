-- APPLIED to prod 2026-07-31 (owner-approved in session). Recorded here after
-- the fact: it was applied through the MCP tool, which writes to the remote
-- project's migration table but leaves no file behind, so the repo could no
-- longer rebuild prod's schema.

-- Two shops with the same name is the bug that cost us a balance on the first
-- real import: the RPC saw one key matching two rows, could not tell which shop
-- the money belonged to, and correctly wrote neither. Enforce here instead of
-- detecting there. Normalised the same way the RPC matches, so "Shop A" and
-- "shop  a" collide rather than sneaking past as different rows.
create unique index retailers_name_norm_unique
  on public.retailers (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

-- Stronger still: two app shops must never point at one Tally ledger, or the
-- same money lands twice. Partial, because an unlinked shop is a normal state.
create unique index retailers_tally_ledger_name_norm_unique
  on public.retailers (lower(regexp_replace(btrim(tally_ledger_name), '\s+', ' ', 'g')))
  where tally_ledger_name is not null and btrim(tally_ledger_name) <> '';
