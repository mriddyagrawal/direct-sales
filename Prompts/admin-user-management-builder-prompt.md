# Builder prompt — In-app admin User Management (`/dashboard/users`)

Move the "add a login account" runbook (`docs/add-user-runbook.md`) into the app as an **admin-only** screen, so the owner never has to touch the Supabase dashboard + SQL Editor to onboard/rename/deactivate a salesman or reset a password.

**This is a security-critical feature.** The whole thing runs on the privileged **service-role** client (`src/lib/supabase/service.ts`, `server-only`), which bypasses RLS and every grant — the same power the Supabase dashboard has. A single missing admin-check is a privilege-escalation hole (any salesman could mint themselves an admin). Read the "Security model" section first and treat it as non-negotiable.

## Context you must know before starting

- **Every mutation in the app today is client-side** through the RLS browser client (`@/lib/supabase/client`) — see the Active toggle in `src/app/dashboard/products/ProductsPricing.tsx` (`createClient().from("products").update(...)`). **User management can't be done that way** — the service client is `server-only` and must never reach the browser. So this feature is the app's **first real set of Server Actions** (only `src/app/login/actions.ts` exists today). Establish them cleanly.
- **Middleware only separates salesman vs staff** (`src/lib/supabase/middleware.ts`, `ROLE_HOME`): salesman → `/`, accountant **and** admin → `/dashboard`. It does **not** distinguish admin from accountant on `/dashboard/*`. So an accountant can reach `/dashboard/users` at the middleware layer — the admin gate must be enforced **in the page and in every action**, not assumed from routing.
- **No schema change, no new env var.** `public.profiles` already has `id, username (citext, unique, ^[a-zA-Z0-9_.]{3,20}$), full_name, role (admin|accountant|salesman), active, created_at`. The `create_profile_for_new_user` trigger auto-inserts a `profiles` row (role `salesman`, `username = NULL`, `full_name = email`) inside the same transaction as the auth-user insert, so by the time `admin.createUser` returns, the profile row exists. `SUPABASE_SECRET_KEY` is already set (login uses it).
- **The dashboard's Supabase "Display name" ≠ our display name.** The app's display name is `profiles.full_name`. Ignore Supabase Auth's own metadata entirely — set `full_name`/`username`/`role` explicitly via SQL/PostgREST, exactly as the updated runbook does.

## Security model (the core of this feature — get it exactly right)

Two independent gates, both required (belt and suspenders):

1. **Page gate** — `src/app/dashboard/users/page.tsx` is a Server Component. Fetch the caller's own `role` + `active` via the **RLS** server client (`@/lib/supabase/server`, same pattern as `dashboard/layout.tsx` and `products/page.tsx`). If not an **active admin**, `redirect("/dashboard")`. An accountant must never see the list (it exposes emails + roles).
2. **Action gate** — **every** Server Action re-verifies the caller is an active admin **server-side, from the session cookie** (never from a client-passed argument) *before* it touches the service client. Factor this into one helper and call it first in every action:
   ```ts
   // src/app/dashboard/users/actions.ts (or a server-only lib)
   async function requireAdmin(): Promise<{ callerId: string }> {
     const supabase = await createClient(); // RLS, session-scoped
     const { data: { user } } = await supabase.auth.getUser();
     if (!user) throw new Error("Not authenticated");
     const { data: me } = await supabase
       .from("profiles").select("role, active").eq("id", user.id).maybeSingle();
     if (!me || !me.active || me.role !== "admin") throw new Error("Forbidden");
     return { callerId: user.id };
   }
   ```
   Only **after** `requireAdmin()` passes may an action construct `createServiceClient()`. The service client is used **only** for the privileged op — never returned, never leaked, never reachable from a Client Component (`server-only` already makes that a build error).

The reviewer will verify the gate by **executing as a non-admin** (accountant): the page must redirect, and invoking the actions must fail closed with **no mutation**.

## The operations (all via the service client, inside gated actions)

| Action | Implementation |
|---|---|
| **Create user** | `serviceClient.auth.admin.createUser({ email, password, email_confirm: true })` (D3: auto-confirm, no verification email). Then set the app fields: `serviceClient.from("profiles").update({ username, full_name, role }).eq("id", data.user.id)` (the trigger already made the row). |
| **Edit profile** | `serviceClient.from("profiles").update({ username, full_name, role }).eq("id", targetId)`. |
| **Reset password** | `serviceClient.auth.admin.updateUserById(targetId, { password })`. No email round-trip. |
| **Deactivate / reactivate** | `serviceClient.from("profiles").update({ active }).eq("id", targetId)`. **Never delete** — orders reference the salesman's profile, and `profiles.id` cascades from `auth.users`, so deletion would corrupt order history. Deactivation is enforced everywhere already (middleware fails closed on `active=false`; `email_for_username` returns NULL for inactive). |
| **List users** | In the page (already admin-gated), read emails via `serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 })` and profile fields via `serviceClient.from("profiles").select("id, username, full_name, role, active, created_at")`; merge by `id` into one row list (username, full_name, role, email, active). |

### Validation (surface friendly errors; the DB already enforces the hard rules)
- **username**: `^[a-zA-Z0-9_.]{3,20}$`, case-insensitive-unique. Validate in the action; also catch the unique-violation from Postgres → `"That username is already taken."`
- **role**: exactly one of `admin | accountant | salesman`.
- **email**: basic format; `createUser` errors on a duplicate → `"That email is already in use."`
- **password**: require **≥ 8 chars** (client + server). **Typed twice** — a password + a confirm field that must match before the form can submit (client-side, guards against typos since there's no email-reset safety net); mismatch shows `"Passwords don't match."` and blocks submit. Only the confirmed password is sent to the action. Surface any GoTrue error verbatim-ish.
- **full_name**: non-empty (trimmed).
Return a typed `{ error: string | null }` (plus created row where useful); do **not** throw raw Postgres/GoTrue errors to the UI, and **never** log or echo the password.

### Self-lockout guards (server-side, in the actions)
- An admin **cannot deactivate their own account** (`targetId === callerId && active === false` → reject).
- An admin **cannot demote themselves** out of admin (`targetId === callerId && role !== "admin"` → reject).
- **Last-admin guard**: reject any deactivate/demote that would leave **zero active admins** (count `active admins` first). Message: `"There must be at least one active admin."`

## UI — reuse the Products patterns

1. **Nav tab (admin-only).** `src/app/dashboard/layout.tsx` currently selects only `full_name` — also select `role`, and pass `role` (or `isAdmin`) to `DashboardNav`. In `src/components/DashboardNav.tsx`, add a **Users** tab (`{ href: "/dashboard/users", label: "Users" }`) to `TABS` **only when the caller is admin** — in both the desktop rail and the mobile bottom bar. Accountant sees the existing 3 tabs, unchanged.
2. **`src/app/dashboard/users/page.tsx`** — Server Component: page gate (redirect non-admins) → fetch merged user list via the service client → render `<UsersAdmin users={...} callerId={...} />`.
3. **`UsersAdmin.tsx`** (client) — mirror `ProductsPricing.tsx`: a desktop table (`Username · Display name · Role · Email · Active`) + mobile cards; row-click opens the edit modal; a **"+ Add user"** button opens the add modal; the **Active** toggle reuses the `useOptimistic` + busy-`Set` + `router.refresh()` pattern — but it calls the **`setUserActive` server action**, not a client supabase write. Render straight from the `users` prop (the ㉜🅐 render-from-prop rule), refresh after each mutation.
4. **`UserModal.tsx`** (client) — shared Add/Edit like `ProductModal.tsx`:
   - **Add**: email, password **+ confirm password** (typed twice, must match), username, full_name, role → `createUser` action. On success show a one-time "Share these credentials — the password won't be shown again" note.
   - **Edit**: username, full_name, role (all editable) + a **Reset password** affordance — **new password + confirm** (typed twice, must match) → `resetUserPassword` + the active state. No email edit for v1 (changing the login email is a rarer op; skip). No delete button.
5. **Actions** live in `src/app/dashboard/users/actions.ts` (`"use server"`): `createUser`, `updateUserProfile`, `resetUserPassword`, `setUserActive` — each starts with `requireAdmin()`, then the service-client op, returns `{ error }`. Keep the styling consistent with the S8 grammar (hairlines, mono figures, muted metadata) used across the dashboard.

## Suggested commits (small + atomic, reviewer verifies each by execution)
1. **Gated Server Actions** — `actions.ts` with `requireAdmin()` + `createUser`/`updateUserProfile`/`resetUserPassword`/`setUserActive`, all guards (validation + self-lockout + last-admin). No UI yet.
2. **Page + nav** — admin-only `Users` tab (layout + DashboardNav change), `/dashboard/users` page with the page gate + user list (table/cards), Active toggle wired to `setUserActive`.
3. **Add/Edit modal** — `UserModal` for create + edit + reset-password.

## Acceptance (reviewer executes — do not accept on read)
- **Admin happy path:** create a salesman → appears in the list → that person logs in with the new **username + password**. Change role to accountant/admin → routing/permissions follow. Reset password → old password fails, new works. Deactivate → that user can no longer log in (middleware); reactivate restores it.
- **Security (the important one):** as an **accountant**, `/dashboard/users` redirects to `/dashboard`, the Users tab is absent, and directly invoking each Server Action fails closed (`Forbidden`, **no DB change**). The service key never appears in any client bundle.
- **Validation:** duplicate username, bad username format, duplicate email, and < 8-char password each show a friendly error and make no partial write.
- **Self-lockout:** an admin cannot deactivate or demote themselves, and cannot remove the last active admin.
- `npm run build` clean; `tsc`/eslint clean. Types don't need regenerating (no schema change), but if you touch generated types confirm they still match.

## Guardrails
- **No schema/RLS/RPC migration** — this is app-layer only. If you think you need one, stop and reconsider; the service client already has full access and the page/action gates do the authorization.
- **Service client stays server-only.** Never import it into a Client Component; never pass it or its results' secrets to the client; never expose `SUPABASE_SECRET_KEY`.
- **Never delete a user** (auth or profile) — deactivate only.
- Don't regress existing dashboard routing, the accountant experience, or the Products/Retailers pages. Passwords are never logged, echoed back, or persisted anywhere but Auth.
- Keep `docs/add-user-runbook.md` accurate: once this ships, add a one-line note at its top that the in-app **Users** screen is now the primary path and the SQL steps are the fallback.
