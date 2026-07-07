# Spec — Roles, Auth, and Permissions (RLS)

Supabase Auth email+password, admin-created accounts, no self-signup (D3). Postgres RLS is the permission system; the UI merely reflects it.

## Roles

| Role | Who | Purpose |
|---|---|---|
| `salesman` | Field salesmen (1–2) | Create/submit orders, edit own within window, view own history, quick-add retailers. |
| `accountant` | The accountant (1) | See everything live; process/edit/cancel orders; price products; verify retailers; print pick slips. |
| `admin` | The owner | Everything the accountant can, plus user management and catalog administration. |

### What each role actually does, day to day

- **Salesman** — the field rep. Lives in the mobile-first order flow: builds a Quick Order from the priced catalog, submits it, can still adjust it inside the edit window, and can look back at their own order history. Never sees an order they didn't create, never sees an unpriced SKU, never touches a table directly — every write is a checked RPC.
- **Accountant** — the back-office operator. Lives in the dashboard: watches the live orders queue, opens the workbench to process/edit/cancel any order (with a mandatory reason once the salesman's window has closed), keeps the product price list current, clears the retailer-verification queue, and prints pick slips for the godown.
- **Admin (owner)** — intended as **oversight and escalation, not daily operation**: keep an eye on the queue, step in for exceptions, and handle the things only an owner should (creating/deactivating accounts, changing a profile's role, catalog administration beyond day-to-day pricing).

### Current reality: admin and accountant are functionally identical in-app

Every RPC role check in the codebase (`submit_order`, `update_order_items`, `cancel_order`, `process_order`) branches on `v_role in ('accountant', 'admin')` — there is no admin-only branch anywhere, and the dashboard nav/UI does not differentiate the two roles at all. The *only* things admin can do that accountant can't are outside the app entirely: creating users and setting `profiles.role`/`username`, done by hand in Supabase Studio per the provisioning runbook below.

So today, "admin only oversees/escalates" is an **organizational convention the owner has chosen to follow, not a permission the system enforces** — nothing stops an admin account from doing full-time accountant-style order processing, and nothing in the UI signals "you're the escalation path." **Decision: leave this as is (owner-confirmed 2026-07-07)** — see [decisions.md](../decisions.md) D11 for the full reasoning and what would need to change if a real enforced split is ever wanted.

## Provisioning (runbook)

1. Admin creates the user in Supabase Dashboard → Authentication → "Add user" (email + password, auto-confirm on). **Also set a username in User Metadata** — `{"username": "raju1"}` (D9) — the login screen uses this, not the email; pick it freely, never just the email's local-part.
2. The `create_profile_for_new_user` trigger inserts a `profiles` row with role `salesman` and `username` from that metadata (NULL if omitted — fix in Studio afterward, step 3-style).
3. For the accountant/admin, the admin edits `profiles.role` (and `profiles.username` if missed at creation) in Supabase Studio.
4. Deactivation = `profiles.active = false` (all policies check it); never delete rows — orders reference them.
5. Password resets: admin-initiated from the dashboard (fine at this team size).

## RLS matrix

Default deny everywhere; these are the **only** allowed operations. "own" = row's `salesman_id = auth.uid()` (or order-parent equivalent). All policies also require `profiles.active`.

| Table | salesman | accountant | admin |
|---|---|---|---|
| `profiles` | SELECT all (names are needed on orders); UPDATE own `full_name` only | SELECT all | SELECT/UPDATE all |
| `brands` | SELECT where `active` | SELECT all | ALL |
| `products` | SELECT where `active AND price_paise IS NOT NULL` — unpriced SKUs are invisible at the database level (D2) | SELECT all; UPDATE (pricing, `tally_name`, `active`) | ALL |
| `retailers` | SELECT where `active`; INSERT with `verified = false, created_by = auth.uid()` | ALL | ALL |
| `orders` | SELECT own. **No direct INSERT/UPDATE/DELETE** — writes only via RPCs | SELECT all. Writes via RPCs | ALL (via RPCs) |
| `order_items` | SELECT via own parent order | SELECT all | SELECT all |
| `order_events` | SELECT via own parent order | SELECT all | SELECT all |
| *(any table)* | No DELETE anywhere; `order_events` is append-only for everyone | | |

## Why RPC-only writes for orders

The mutating paths (`submit_order`, `update_order_items`, `cancel_order`, `process_order` — see [data-model.md](data-model.md)) are `security definer` functions that:

1. Check the caller's role and (for salesmen) ownership + `now() < editable_until` **inside the transaction** — the client clock and client state are never trusted.
2. Snapshot names/prices **from the catalog**, never from client input — a tampered request cannot invent a price.
3. Write the audit event atomically with the change.

The `guard_order_transition` trigger backstops the RPCs, so even a future privileged code path cannot make an illegal transition silently.

## Login flow (username, not email)

Registration is still email+password (D3) — but staff **log in** with a separately-chosen `profiles.username` (D9), not their email. Supabase Auth has no native "sign in by arbitrary field," so:

1. Client submits `{ username, password }` to a Next.js **Server Action** (never the browser's Supabase client directly).
2. The action calls `public.email_for_username(username)` using a **service-role client** (`src/lib/supabase/service.ts`, server-only). It returns the email only for an **active** profile; NULL for a nonexistent *or* deactivated username — the two look identical from the outside.
3. The action calls `signInWithPassword({ email, password })` with the looked-up email, using the regular server-side (RLS-scoped) Supabase client.
4. Same generic "Wrong username or password" message regardless of which of the three ways it failed (bad username, deactivated, bad password).

**`email_for_username` has NO grant to `anon` or `authenticated`** — only `service_role` can call it. An earlier pass granted it to `anon` on the theory that calling it from a Server Action rather than client-side JS would prevent harvesting; that was wrong and the REVIEWER proved it live (calling the function directly as `anon` returned a real email, completely bypassing the app). The public anon/publishable key ships in the client bundle by design, so *any* anon-grantable endpoint is reachable directly against the REST API regardless of what the app's own code does — the fix has to be the grant itself, not which code path calls it. This is the only RPC in the project that needs `service_role`; see D9's correction for the full account.

## Session/config notes

- The publishable key (new-style `sb_publishable_...`, replacing the legacy `anon` JWT) ships in the client (safe: RLS is the wall). The secret key (`sb_secret_...`, replacing the legacy `service_role` JWT) exists only in server-side env (`SUPABASE_SECRET_KEY`) — used by the username-login lookup (D9) and the future seed script; never in client bundles, never in the repo.
- Role lookup inside policies uses a `security definer` helper (`auth_profile_role()` reading `profiles`) to avoid RLS recursion — standard Supabase pattern. (Named `auth_profile_role`, not `current_role`, because `current_role` collides with a PostgreSQL reserved/SQL-standard keyword: unqualified `current_role()` is a syntax error, and the bare identifier silently resolves to the Postgres session role instead of our helper.)
- Realtime subscriptions respect RLS (dashboard subscribes to `orders`; salesmen receive only their own rows if they subscribe at all).

## Verification protocol (for the REVIEWER)

Reading policy SQL is not verification. With three real authenticated clients (one per role):

1. Salesman A submits an order; salesman B must not see it (SELECT returns nothing) — **and** B's direct `update`/RPC attempts against A's order must fail.
2. Salesman attempts a direct `insert into orders` / `update orders set status …` → permission denied (no policy).
3. Salesman calls `update_order_items` after `editable_until` → rejected; accountant same call → succeeds with `edited_after_lock` event.
4. Salesman `select * from products` must return **no** `price_paise IS NULL` rows; accountant sees all 42.
5. Craft a `submit_order` payload with a fake price field → stored line must show the catalog price (client price ignored).
6. Deactivated salesman (`active = false`) can no longer read or write anything.
