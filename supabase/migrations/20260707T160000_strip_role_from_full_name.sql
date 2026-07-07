-- Owner-requested cleanup: profiles.full_name was seeded with the role
-- baked in for the 3 test accounts ("Mriddy (accountant)", "Vikram
-- (admin)", "Mridul (salesman)") — full_name is a real display name
-- (shown in order history, HISTORY events, the dashboard nav account
-- label, D10), not a role label; role already has its own column.
-- Strips any trailing " (...)" parenthetical rather than hardcoding the
-- 3 known rows, so any future account created the same (wrong) way gets
-- fixed the same way too.

update public.profiles
set full_name = regexp_replace(full_name, '\s*\([^)]*\)\s*$', '')
where full_name ~ '\s*\([^)]*\)\s*$';
