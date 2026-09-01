-- CONTRACT half of 20260901032758 (deposit receipt no. + discount).
--
-- ⚠️ APPLY ONLY AFTER the deploy carrying feat/deposit-receipt-discount is
-- LIVE on Vercel. This drops the pre-receipt RPC signatures that the
-- PREVIOUS deploy still calls — dropping them early breaks live deposit
-- saving; dropping them after the cutover closes the permissive era (the old
-- shapes accept a deposit with no receipt ref, which the server must no
-- longer allow once the new form is everyone's form).
--
-- The expand half was applied by the owner on 2026-09-01 (dashboard SQL
-- editor); the PostgREST overload probe passed — all four call shapes
-- resolved, no PGRST203 — so old and new coexisted cleanly during the test
-- window, exactly as designed.

drop function if exists public.create_deposit(uuid, integer, text, text);
drop function if exists public.update_deposit(uuid, uuid, integer, text, text);
