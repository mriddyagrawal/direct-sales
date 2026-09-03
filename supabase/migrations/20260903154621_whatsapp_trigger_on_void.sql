-- WhatsApp v2 (owner 2026-09-03): voids message out too — the retailer gets
-- a cancellation, the owner gets the void alert with the quoted reason.
-- ONLY the trigger is recreated; whatsapp_receipt_webhook() is untouched
-- (the prod function body holds the real WA_TRIGGER_SECRET — the repo copy
-- of its migration carries a placeholder, and this file must never make
-- anyone re-run that CREATE OR REPLACE).

drop trigger if exists whatsapp_receipt_on_deposit_created on public.deposit_events;

create trigger whatsapp_receipt_on_deposit_created
  after insert on public.deposit_events
  for each row when (new.action in ('created', 'voided'))
  execute function public.whatsapp_receipt_webhook();
