-- Silence deposit PUSH notifications (owner 2026-09-05): ~50 buzzes/day of
-- "received ₹5,000" was drowning the pushes the owner actually watches for —
-- order lifecycle (built → dispatched, approvals) and new retailers. Deposits
-- already reach the owner through the WhatsApp alert pipeline; the push was
-- duplicate dopamine.
--
-- Surgical: ONLY the deposit-events → notify trigger goes. Order + retailer
-- pushes, the bell, push_subscriptions, the notify function, and the ENTIRE
-- WhatsApp receipt pipeline (its own trigger on this same table) are
-- untouched. Reversible with one CREATE TRIGGER (see 20260725110452).

drop trigger if exists notify_on_deposit_event on public.deposit_events;
