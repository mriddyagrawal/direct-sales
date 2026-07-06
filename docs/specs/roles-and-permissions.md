# Spec — Roles, Auth, and Permissions (RLS)

Supabase Auth email+password, admin-created accounts, no self-signup (D3). Postgres RLS is the permission system; the UI merely reflects it.

## Roles

| Role | Who | Purpose |
|---|---|---|
| `salesman` | Field salesmen (1–2) | Create/submit orders, edit own within window, view own history, quick-add retailers. |
| `accountant` | The accountant (1) | See everything live; process/edit/cancel orders; price products; verify retailers; print pick slips. |
| `admin` | The owner | Everything the accountant can, plus user management and catalog administration. |

## Provisioning (runbook)

1. Admin creates the user in Supabase Dashboard → Authentication → "Add user" (email + password, auto-confirm on).
2. The `create_profile_for_new_user` trigger inserts a `profiles` row with role `salesman`.
3. For the accountant/admin, the admin edits `profiles.role` in Supabase Studio.
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

## Session/config notes

- Anon key ships in the client (safe: RLS is the wall). `service_role` key exists only in server-side env (`SUPABASE_SERVICE_ROLE_KEY`) for the seed script; never in client bundles, never in the repo.
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
