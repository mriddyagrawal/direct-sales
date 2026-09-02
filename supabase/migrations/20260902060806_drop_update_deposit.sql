-- Void-only deposits (owner 2026-09-02): editing a deposit becomes IMPOSSIBLE,
-- not merely hidden. A wrong deposit is voided (void_deposit: creator within
-- the 30-minute window / admin anytime, reason required) and recorded again —
-- so the retailer's WhatsApp history can never disagree with the books.
--
-- Drops BOTH live update_deposit overloads, and — the long-pending contract
-- for the outstanding-era expand — the stale 6-arg create_deposit. The app
-- has called only the 7-arg create_deposit since the snapshot shipped
-- (p_previous_outstanding_paise key always present).

drop function if exists public.update_deposit(uuid, uuid, integer, text, text, integer, integer, text);
drop function if exists public.update_deposit(uuid, uuid, integer, text, text, integer, text);
drop function if exists public.create_deposit(uuid, integer, text, text, integer, text);
