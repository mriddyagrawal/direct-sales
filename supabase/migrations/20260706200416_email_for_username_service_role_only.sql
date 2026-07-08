-- M-app.2: close flag (21) — email_for_username was anon/authenticated-
-- executable, so it was callable directly against the REST API by anyone
-- holding the public anon/publishable key (which ships in the client
-- bundle by design), completely bypassing the app's Server Action. The
-- REVIEWER proved this live: `set role anon; select
-- email_for_username('mridul')` returned the real email. D9's claim that
-- "calling it from a Server Action is what closes the harvest risk" was
-- wrong — the grant on the function is what controls access, not which
-- code path happens to call it.
--
-- Fix: revoke anon/authenticated entirely. service_role already has
-- implicit execute via Supabase's default privileges (confirmed live via
-- has_function_privilege before writing this migration) — the explicit
-- grant below is for clarity/documentation, not because it's load-bearing.
-- Only a server-side service-role client (never in the browser) can call
-- this now; see src/lib/supabase/service.ts.

revoke execute on function public.email_for_username(extensions.citext) from anon, authenticated;
grant execute on function public.email_for_username(extensions.citext) to service_role;
