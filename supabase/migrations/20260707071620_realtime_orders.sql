-- M5.2: add `orders` to the supabase_realtime publication — the dashboard's
-- live orders list (accountant-dashboard.md acceptance criterion #1, "within
-- 5s, no refresh") subscribes to postgres_changes INSERT on this table.
-- Realtime respects RLS (roles-and-permissions.md), so a salesman who
-- happened to subscribe would still only ever receive their own rows.

alter publication supabase_realtime add table public.orders;
