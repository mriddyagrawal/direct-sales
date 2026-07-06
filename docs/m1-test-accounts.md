# M1 test accounts

Three real Supabase Auth accounts exist on the live project (`ugjwcbxyyuowiyhczcrh`) for
exercising the RLS matrix and the four RPCs end-to-end. Created by Mridul directly via
Supabase Dashboard → Authentication → Add user (passwords known only to him, never
committed). Roles were then set the same way the provisioning runbook in
[roles-and-permissions.md](specs/roles-and-permissions.md) describes for anyone past the
first signup: the trigger auto-creates every new user as `salesman`, then a plain
`update public.profiles set role = ...` (the SQL equivalent of editing the row in Supabase
Studio) promotes the two staff accounts.

| Email (registration only) | Username (**use this to log in** — D9) | Role | profiles.full_name |
|---|---|---|---|
| `kumarvikramagrawal@gmail.com` | `vikram` | `admin` | Vikram (admin) |
| `mriddyagrawal@gmail.com` | `mriddy` | `accountant` | Mriddy (accountant) |
| `mridul289agrawal@gmail.com` | `mridul` | `salesman` | Mridul (salesman) |

Since D9 (2026-07-07), the login screen asks for **username**, not email — the email above is only how the account was registered/how Supabase identifies it internally. Usernames were backfilled for these three via MCP `execute_sql`, not chosen through any in-app flow (there isn't one — D3, admin-created accounts only).

All three are `active = true`. Passwords are whatever Mridul set when creating them in the
Dashboard — ask him directly if you need to sign in as one of these for manual testing;
they are not recorded anywhere in the repo.

## Using these for the RLS/RPC test path

Sign in via `supabase-js` `signInWithPassword({ email, password })` (or `curl
$SUPABASE_URL/auth/v1/token?grant_type=password` with the anon key + email/password) to get
a real access token, then call the REST/RPC endpoints with that token to exercise:

- roles-and-permissions.md's 6-step RLS verification protocol
- `submit_order` idempotent-retry behavior
- `update_order_items` snapshot preservation across a catalog price change
- the qty 1–9999 bound
- role gating on `process_order` / `cancel_order`

Note: the REVIEWER has already verified all of the above once, using `set local role
authenticated` + a simulated `request.jwt.claim.sub` inside self-rolling-back `DO` blocks
(no real login needed for that technique) — see the M1.5/M1.6 review blocks in
[comments.md](../comments.md). These three persistent accounts exist for real
end-to-end/manual testing (e.g. once the Next.js app is scaffolded) rather than as a
prerequisite for that automated verification.
