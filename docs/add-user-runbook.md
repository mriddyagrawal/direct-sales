# Runbook — Add a login account (in Supabase)

Accounts are **admin-created in Supabase** (D3), and login is by a **username**, not email (D9). There is no in-app user-management screen by design — this is the whole process. Project: `direct-sales` (`ugjwcbxyyuowiyhczcrh`).

**Two things the Supabase dashboard makes confusing — read once:**
- The **"Display name"** column and **User Metadata** in the Users list are Supabase Auth's *own* fields. **Our app ignores them entirely** — it reads `public.profiles.full_name` (the display name) and `public.profiles.username`. So "Display name: –" in that list is normal and irrelevant.
- The **Raw JSON** tab is read-only (you can't type there), and the "Add user" modal's metadata field is fiddly/version-dependent. **Don't rely on metadata.** We set the app fields in SQL instead — reliable and version-proof.

## Create a user (2 minutes)

1. **Supabase Dashboard → Authentication → Users → Add user → Create new user.**
   - **Email** + **Password** — the real credential store. The person never types the email; it's just what Supabase Auth logs in with under the hood. **Whatever you type in Password *is* their password** — hand it to them directly (no email round-trip). Skip the metadata field.
   - **Auto Confirm User: ON** (no email-verification flow — D3).

2. Creating the auth user fires the `create_profile_for_new_user` trigger, which auto-inserts a `public.profiles` row (role `salesman`, `username = NULL`, `full_name = email`). Now set the real app fields in **SQL Editor**:
   ```sql
   update public.profiles p
   set username  = 'raju1',            -- login handle: 3–20 chars, [a-zA-Z0-9_.], case-insensitive-unique
       full_name = 'Raju Kumar',        -- the display name the app shows
       role      = 'salesman'           -- or 'accountant' / 'admin'
   from auth.users u
   where u.id = p.id and u.email = 'raju@gmail.com';
   ```
   - `username` rules: **3–20 chars**, letters / digits / `_` / `.` only, and **case-insensitive-unique** ("Raju" == "raju"). Pattern: `^[a-zA-Z0-9_.]{3,20}$`.

3. **Verify** (SQL Editor):
   ```sql
   select id, username, full_name, role, active from public.profiles where username = 'raju1';
   select public.email_for_username('raju1');  -- must return their email; NULL means it won't log in
   ```

4. The user signs into the app with **username + password**.

## Reset a password — no email needed

The dashboard's "Send password recovery" / "Send magic link" both require a real inbox the person actually checks — useless for placeholder gmails. Set the password directly instead:

- **At creation:** just use the Password field in the Add-user form (above).
- **For an existing user** (`pgcrypto` is installed; this writes the `$2a$` bcrypt hash GoTrue accepts):
  ```sql
  update auth.users
  set encrypted_password = extensions.crypt('THE_NEW_PASSWORD', extensions.gen_salt('bf')),
      updated_at = now()
  where email = 'raju@gmail.com';
  ```

## Fixups

- **Forgot to set the username** (profile shows `username = NULL` → can't log in): run the step-2 `update` above (or just the username):
  ```sql
  update public.profiles set username = 'raju1' where id = '<auth-user-uuid>';
  ```
- **Rename / fix full_name:** `update public.profiles set full_name = 'Raju Kumar' where username = 'raju1';`

## Deactivate (never delete — orders reference the profile)

```sql
update public.profiles set active = false where username = 'raju1';
```
A deactivated account can't log in (`email_for_username` returns NULL for inactive, and every RLS policy checks `active`). Reactivate with `active = true`.

## Why it's these steps

Supabase Auth only authenticates by email/phone — there's no native "log in by arbitrary field." So login does: client → a Next.js Server Action → `public.email_for_username(username)` (called with a **server-only, service-role client** — `anon`/`authenticated` have **no** grant on it since the ㉑ fix, so it's never reachable from the browser) → `signInWithPassword({ email, password })`, returning the email only for an **active** profile. The username lives on `public.profiles.username` (`citext`, unique). A nonexistent username and a deactivated one look identical (both return NULL) — no account enumeration.

The `create_profile_for_new_user` trigger reads `full_name`/`username` from the auth user's metadata *if present*, but we don't depend on that — the SQL `update` in step 2 is the source of truth and works regardless of what the dashboard's metadata UI does.
