-- Notifications Block B (docs/specs/notifications.md §Pipeline) — the three
-- event webhooks feeding the `notify` Edge Function. Owner-approved 2026-07-25
-- ("you can apply the webhooks"). This project had no webhook plumbing at all
-- (supabase_functions schema absent), so: enable pg_net (async HTTP) + one
-- SECURITY DEFINER trigger fn.
--
-- ⚠️ REPO COPY CARRIES A PLACEHOLDER SECRET — the repo is public. The applied
-- prod version (MCP ledger 20260725110452-ish) holds the real value, which
-- lives ONLY in the DB function body + the Edge Function's secret store.
create extension if not exists pg_net;

create or replace function public.notify_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://ugjwcbxyyuowiyhczcrh.supabase.co/functions/v1/notify',
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '<WEBHOOK_SECRET — real value in prod DB + function secrets only>'
    )
  );
  return new;
exception when others then
  -- A notification must NEVER break the business write it rides on: swallow
  -- everything; a lost push is recoverable, a lost order is not.
  return new;
end;
$$;

create trigger notify_on_order_event after insert on public.order_events
  for each row execute function public.notify_webhook();

create trigger notify_on_deposit_event after insert on public.deposit_events
  for each row execute function public.notify_webhook();

-- Storm guard at the DB itself: bulk imports (verified=true) never fire.
create trigger notify_on_new_retailer after insert on public.retailers
  for each row when (new.verified = false) execute function public.notify_webhook();
