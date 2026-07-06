-- M1.6b: close the get_advisors(security) findings from the RLS migration.
--
-- 1. Postgres auto-grants EXECUTE to PUBLIC on function creation (a separate
--    default from the table-grant behavior handled in the RLS migration) —
--    anon still had EXECUTE on every security-definer function. Revoke from
--    PUBLIC and re-grant precisely:
--      - current_role(): authenticated only (needed inside RLS policies —
--        it must stay security definer to avoid the RLS-recursion problem
--        roles-and-permissions.md calls out, so "authenticated can also
--        call it directly via RPC" is an accepted, unavoidable consequence,
--        not a bug — it's read-only and returns only the caller's own role).
--      - create_profile_for_new_user(): nobody. It's RETURNS TRIGGER, only
--        ever invoked by the on_auth_user_created trigger, which does not
--        require the triggering session to hold EXECUTE on the function.
--      - the 4 order RPCs: authenticated only, per the spec ("grant execute
--        to authenticated"). authenticated legitimately calling these
--        directly is the point of the RPC-only write path, so that half of
--        the advisory is expected and accepted, not a finding to silence.
-- 2. Pin search_path on the three trigger functions that didn't get it in
--    the triggers migration (touch_updated_at, recompute_order_total,
--    guard_order_transition) — same hygiene rule as the RPCs, even though
--    none of the three currently has an unqualified table reference.

revoke execute on function public.current_role() from public;
grant  execute on function public.current_role() to authenticated;

revoke execute on function public.create_profile_for_new_user() from public;

revoke execute on function public.submit_order(uuid, uuid, text, jsonb) from public;
grant  execute on function public.submit_order(uuid, uuid, text, jsonb) to authenticated;

revoke execute on function public.update_order_items(uuid, text, jsonb) from public;
grant  execute on function public.update_order_items(uuid, text, jsonb) to authenticated;

revoke execute on function public.cancel_order(uuid, text) from public;
grant  execute on function public.cancel_order(uuid, text) to authenticated;

revoke execute on function public.process_order(uuid) from public;
grant  execute on function public.process_order(uuid) to authenticated;

alter function public.touch_updated_at()       set search_path = public, pg_temp;
alter function public.recompute_order_total()  set search_path = public, pg_temp;
alter function public.guard_order_transition()  set search_path = public, pg_temp;
