-- M1.6c: follow-up to 20260706T150600 — that migration revoked EXECUTE from
-- PUBLIC, but Supabase's default-privilege template grants EXECUTE directly
-- to anon and authenticated on every new function (a separate grant from
-- PUBLIC), so anon still had access per get_advisors. Revoke explicitly by
-- role name, then re-grant to authenticated only where actually needed.

revoke execute on function public.current_role() from anon, authenticated;
grant  execute on function public.current_role() to authenticated;

revoke execute on function public.create_profile_for_new_user() from anon, authenticated;

revoke execute on function public.submit_order(uuid, uuid, text, jsonb) from anon, authenticated;
grant  execute on function public.submit_order(uuid, uuid, text, jsonb) to authenticated;

revoke execute on function public.update_order_items(uuid, text, jsonb) from anon, authenticated;
grant  execute on function public.update_order_items(uuid, text, jsonb) to authenticated;

revoke execute on function public.cancel_order(uuid, text) from anon, authenticated;
grant  execute on function public.cancel_order(uuid, text) to authenticated;

revoke execute on function public.process_order(uuid) from anon, authenticated;
grant  execute on function public.process_order(uuid) to authenticated;
