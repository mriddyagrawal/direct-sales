-- The deposit → WhatsApp receipt trigger (owner 2026-09-01). Mirrors Block
-- B's notify_webhook exactly: pg_net async POST to the whatsapp-receipt Edge
-- Function on every deposit_events 'created' insert. The FUNCTION decides
-- whether to send (previous outstanding entered, retailer has a phone,
-- not already sent) — the trigger stays dumb on purpose.
--
-- ⚠️ REPO COPY CARRIES A PLACEHOLDER SECRET — the repo is public. The
-- applied prod version holds the real value, which lives only in the DB
-- function body + the Edge Function's secret store (WA_TRIGGER_SECRET).
create or replace function public.whatsapp_receipt_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://ugjwcbxyyuowiyhczcrh.supabase.co/functions/v1/whatsapp-receipt',
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-secret', '<WA_TRIGGER_SECRET — real value in prod DB + function secrets only>'
    )
  );
  return new;
exception when others then
  -- A receipt must NEVER break the deposit it rides on: swallow everything;
  -- a lost message is recoverable, a lost collection record is not.
  return new;
end;
$$;

create trigger whatsapp_receipt_on_deposit_created
  after insert on public.deposit_events
  for each row when (new.action = 'created')
  execute function public.whatsapp_receipt_webhook();
