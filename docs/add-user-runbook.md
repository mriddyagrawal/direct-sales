# Runbook — Add a login account (in Supabase)

Accounts are **admin-created in Supabase** (D3), and login is by a **username**, not email (D9). There is no in-app user-management screen by design — this is the whole process. Project: `direct-sales` (`ugjwcbxyyuowiyhczcrh`).

## Create a user (2 minutes)

1. **Supabase Dashboard → Authentication → Users → Add user.**
   - **Email** + **Password** — this is the real credential store. The person never types the email; it's just what Supabase Auth logs in with under the hood.
   - **Auto Confirm User: ON** (no email-verification flow — D3).
   - Expand **User Metadata** and paste (this is where the username comes from):
     ```json
     { "username": "raju1", "full_name": "Raju Kumar" }
     ```
     - `username` rules: **3–20 chars**, letters / digits / `_` / `.` only, and **case-insensitive-unique** ("Raju" == "raju"). Pattern: `^[a-zA-Z0-9_.]{3,20}$`.

2. That's it for a **salesman** — the `create_profile_for_new_user` trigger auto-creates the `profiles` row with role `salesman`, the username, and full_name.

3. For an **accountant** or **admin**, promote the role in **SQL Editor**:
   ```sql
   update public.profiles set role = 'accountant' where username = 'raju1';  -- or 'admin'
   ```

4. **Verify** (SQL Editor):
   ```sql
   select id, username, full_name, role, active from public.profiles where username = 'raju1';
   select public.email_for_username('raju1');  -- must return their email; NULL means it won't log in
   ```

5. The user signs into the app with **username + password**.

## Fixups

- **Forgot the username at creation** (profile shows `username = NULL` → can't log in): set it directly —
  ```sql
  update public.profiles set username = 'raju1' where id = '<auth-user-uuid>';
  ```
- **Rename / fix full_name:** `update public.profiles set full_name = 'Raju Kumar' where username = 'raju1';`
- **Password reset:** Dashboard → Authentication → the user → reset/change password (admin-initiated, D3).

## Deactivate (never delete — orders reference the profile)

```sql
update public.profiles set active = false where username = 'raju1';
```
A deactivated account can't log in (`email_for_username` returns NULL for inactive, and every RLS policy checks `active`). Reactivate with `active = true`.

## Why it's these steps

Supabase Auth only authenticates by email/phone — there's no native "log in by arbitrary field." So login does: client → a Next.js Server Action → `public.email_for_username(username)` (called with a **server-only, service-role client** — `anon`/`authenticated` have **no** grant on it since the ㉑ fix, so it's never reachable from the browser) → `signInWithPassword({ email, password })`, returning the email only for an **active** profile. The username lives on `public.profiles.username` (`citext`, unique). A nonexistent username and a deactivated one look identical (both return NULL) — no account enumeration.
