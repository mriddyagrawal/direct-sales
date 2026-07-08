-- M-app.1: username-based login (owner decision, 2026-07-07 — see decisions.md D9)
--
-- Registration stays email+password (D3: admin-created accounts). Login
-- switches to a separately-chosen username, freely picked by the admin at
-- account-creation time — never derived from the email's local-part.
--
-- Supabase Auth only authenticates by email or phone; there is no native
-- "sign in by arbitrary field." So the login flow becomes:
--   1. Client calls public.email_for_username(username) — anon-callable,
--      security definer, since the caller isn't authenticated yet.
--   2. That returns the account's email (only for an ACTIVE profile; NULL
--      otherwise — a deactivated account's email is never handed back, and
--      a nonexistent username looks identical to a deactivated one).
--   3. Client calls supabase.auth.signInWithPassword({ email, password })
--      with the looked-up email, same as before.
--
-- citext gives case-insensitive username matching/uniqueness for free
-- ("Raju" and "raju" are the same account) without hand-rolled lower()
-- indexes.

create extension if not exists citext with schema extensions;

alter table public.profiles
  add column username extensions.citext unique;

alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-zA-Z0-9_.]{3,20}$');

-- Auto-provisioning trigger: username comes from the admin-supplied user
-- metadata at account-creation time (Dashboard "Add user" -> User Metadata
-- -> {"username": "raju1"}). Left NULL if omitted — same "set it in Studio
-- afterward" pattern already used for role promotion; a NULL username
-- simply can't sign in via this path yet (the lookup RPC returns nothing).
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'salesman',
    new.raw_user_meta_data->>'username'
  );
  return new;
end;
$$;

create or replace function public.email_for_username(p_username extensions.citext)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = p_username
    and p.active
  limit 1;
$$;

revoke execute on function public.email_for_username(extensions.citext) from public, anon, authenticated;
grant execute on function public.email_for_username(extensions.citext) to anon, authenticated;
