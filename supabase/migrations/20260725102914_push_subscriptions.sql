-- Push notifications (docs/specs/notifications.md v1.2) — the ONE DB change.
-- Owner-approved 2026-07-25 ("i like the tables and the migrations").
-- One row per device per user: the device's push delivery address + keys.
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_label text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Owner-only: each user manages exactly their own device rows. The Edge
-- Function reads all rows via the service-role key (bypasses RLS by design).
create policy push_subs_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subs_insert_own on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subs_update_own on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subs_delete_own on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- The three event webhooks (Block B) apply AFTER the `notify` Edge Function
-- is deployed — see docs/specs/notifications.md §Pipeline. They are part of
-- this same owner approval; applied as their own migration at that step.
