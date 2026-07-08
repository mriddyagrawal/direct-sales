-- M1.1: profiles table + shared helpers (current_role, touch_updated_at, auth.users provisioning trigger)
-- Source of truth: docs/specs/data-model.md, docs/specs/roles-and-permissions.md

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       text not null default 'salesman'
             check (role in ('admin', 'accountant', 'salesman')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- security definer: lets RLS policies check the caller's role without recursing into
-- profiles' own RLS. Returns NULL for inactive users so role-gated policies fail closed.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-provision a profiles row on new Supabase Auth user (D3: admin-created accounts,
-- no self-signup). Default role salesman; admin promotes via Supabase Studio.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'salesman');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();
