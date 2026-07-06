# BUILDER PROMPT — M1: Stand up the Supabase database (direct-sales)

You are the **BUILDER** for `direct-sales` (Ganpati Enterprises B2B order-capture app: Next.js + Supabase + Vercel). Your job in this milestone (M1) is to build the **entire Postgres backend** — schema, sequences, triggers, security-definer RPCs, RLS, indexes, and the Zebronics catalog seed — so the app has a correct, locked-down data layer to build on.

Work in small atomic commits on branch **`feature/supabase-setup`**. A separate REVIEWER session verifies every commit by execution and writes review blocks into `comments.md`. Read the newest `comments.md` review blocks before each commit; **any blocking (❌) issue must be fixed in your very next commit** before new work. Never edit the REVIEWER's blocks. Commit messages must be **literally accurate** — the REVIEWER checks claims against the code and flags drift.

---

## 0. Hard constraints — read before touching anything

- **Supabase is managed via the Supabase MCP only.** Live project: `direct-sales`, ref **`ugjwcbxyyuowiyhczcrh`** (org `mriddyagrawal` = `eyumlooixnjibrpfgepb`; PG17; region **ap-south-1 / Mumbai**). Do **NOT** run `supabase init`, do **NOT** start a local Docker/Postgres/Supabase stack, do **NOT** create a `config.toml`. There is no local database.
- **Every schema change is a `.sql` migration file committed to the repo** under `supabase/migrations/` (create the dir; do NOT add `config.toml`). The repo `.sql` is the **source of truth**; the MCP is only the apply mechanism. For each file: apply it with MCP `apply_migration` (its `name` = the file's stem, `query` = the file's SQL), verify, then commit. The repo and the live DB must never diverge — the whole DB must be reproducible from `supabase/migrations/*.sql` alone, in filename order.
- **Money is integer paise.** No `float`/`real`/`double`, no `numeric` for money. Line totals and order totals are `bigint` (a single line can exceed int4: `9999 × ₹9,138 = 9.14e9 paise`).
- **Never trust the client** for prices, status, totals, ownership, or time. Snapshots are copied from the catalog row **inside the transaction**; `now()` is evaluated **in Postgres**.
- **`service_role` key never enters the repo or any client bundle.** It lives only in server-side env (`SUPABASE_SERVICE_ROLE_KEY`), and you don't need it for MCP-applied migrations at all.

## 1. Source of truth — conform exactly

These specs are authoritative. Copy the `CREATE TABLE`/sequence/index DDL from them **verbatim** (they are already reviewed and carry deliberate details — preserved typos, check constraints, bigint choices). If you believe a spec is wrong, update the spec **in the same commit** as the code and call it out in the commit message — do not silently deviate.

- `docs/specs/data-model.md` — tables, columns, the RPC table, the trigger table, indexes, and the 5 invariants.
- `docs/specs/order-lifecycle.md` — state machine, the derived "locked" condition, edit window, numbering, the `order_events.action` catalog and payload shapes.
- `docs/specs/roles-and-permissions.md` — the RLS matrix, RPC-only rationale, and the REVIEWER's 6-step verification protocol.
- `docs/specs/seed-data.md` — CSV → `products` transformation rules and the post-seed verification queries.
- `docs/decisions.md` — D1–D7 (esp. D1 gaps-are-fine, D2 unpriced-hidden, D3 admin-created auth).

## 2. Migration plan (ordered — one atomic commit per numbered file unless noted)

Name files `supabase/migrations/<UTC-timestamp>_<slug>.sql` (e.g. `20260706T120000_profiles_and_helpers.sql`). Apply each via MCP `apply_migration` immediately after writing it, verify, then commit.

1. **`profiles` + shared helpers.**
   - `create table public.profiles (...)` per data-model.md.
   - Helper fn `public.current_role()` — `security definer`, reads `profiles.role` for `auth.uid()`, used inside policies to avoid RLS recursion (standard Supabase pattern). Set an explicit `search_path` (see §5).
   - Generic `public.touch_updated_at()` trigger function (sets `NEW.updated_at = now()`).
   - `public.create_profile_for_new_user()` + trigger on `auth.users` insert → inserts a `profiles` row, role `salesman` (D3, no self-signup). **Platform risk:** direct SQL on the `auth` schema is restricted on hosted Supabase. Apply this via MCP and confirm the trigger actually installs (check with `execute_sql`); if the platform rejects a trigger on `auth.users`, **stop and surface it** as a spec deviation (do not silently drop profile provisioning) — the fallback is a documented admin-flow insert, which is an owner decision.
2. **Catalog: `brands`, `products`, `retailers`** (+ `products_brand_category_idx`). Verbatim DDL from data-model.md, including `price_paise integer check (price_paise > 0)` (NULL = TBD) and `retailers.verified default false`.
3. **Orders core: `order_no_seq` (start 1001), `orders`, `order_items`, `order_events`** (+ the `orders_*`, `order_items_order_idx`, `order_events_order_idx` indexes). Keep every check constraint (`status in (...)`, `qty between 1 and 9999`, the `unique (order_id, product_id)`), and the `bigint` money columns.
4. **Triggers.**
   - `touch_updated_at` on `products` and `orders`.
   - `recompute_order_total` AFTER INSERT/UPDATE/DELETE on `order_items` → `orders.total_paise = sum(line_total_paise)`.
   - `guard_order_transition` BEFORE UPDATE on `orders` → reject every illegal status transition (`processed→submitted`, any resurrection of `cancelled`, any status change not made by the RPCs). **Interaction pin:** it must still ALLOW the internal `total_paise` write coming from `recompute_order_total` (a non-status update) while rejecting out-of-band status writes. Get this interaction right — the REVIEWER tests it directly.
5. **RPCs (all `security definer`, explicit `search_path`).** Signatures per data-model.md §"Write paths":
   - `submit_order(id, retailer_id, notes, items[])` — validate each item (product active + `price_paise IS NOT NULL` + qty 1–9999); snapshot `product_name`/`unit_price_paise` **from the catalog** (ignore any client-sent price); compute `line_total_paise` server-side in bigint; assign `order_no` from the sequence + build `order_ref = 'ORD-' || <IST year of submitted_at> || '-' || order_no`; set `submitted_at = now()`, `editable_until = now() + interval '2 hours'` (the window constant lives here); write a `submitted` event `{item_count, total_paise}`. **Idempotent on `id`:** a retry carrying an already-existing `id` returns that order **untouched** — a differing payload is ignored, never merged.
   - `update_order_items(order_id, notes, items[])` — salesman (own + `now() < editable_until`) or accountant/admin (any time; past-window accountant edit writes `edited_after_lock`). **Snapshot-preservation pin:** DIFF by `product_id` — surviving lines keep their **original** snapshot columns (untouched), only `qty` updates; genuinely new products snapshot at **edit-time** catalog price; removed products are deleted. **Do NOT delete-all-and-reinsert** (that silently re-snapshots survivors at current prices and violates the "price at order time is the deal" rule). Write `items_changed` (salesman) / `edited_after_lock` (accountant) with `{before:[...], after:[...]}` where each element is `{sku, qty, unit_price_paise}` (join `products` for `sku` at event-write time).
   - `cancel_order(order_id, reason)` — owning salesman while editable, or accountant/admin any time (accountant/admin **must** supply a reason); set `status='cancelled'`, `cancelled_at`; write `cancelled` event `{reason?}`.
   - `process_order(order_id)` — accountant/admin; `submitted → processed`; set `processed_at/by`; write `processed` event. Processing beats the edit timer (locks the salesman out immediately).
   - Grant `execute` on the 4 RPCs to `authenticated`.
6. **RLS.** Enable RLS on **every** table (default deny). Implement the matrix in roles-and-permissions.md exactly — including: salesmen `SELECT` on `products` only where `active AND price_paise IS NOT NULL` (D2, enforced at the DB, not the UI); salesmen `SELECT own` orders and no direct `INSERT/UPDATE/DELETE` (writes go only through the RPCs); `retailers` salesman `INSERT` forced to `verified=false, created_by = auth.uid()`; `order_events` append-only for everyone (no UPDATE/DELETE policy for any role); no DELETE anywhere. Ensure base table grants to `anon`/`authenticated` match the matrix (grant the SELECTs the policies expect; do **not** grant INSERT/UPDATE on `orders`/`order_items`) so RLS + absent grant = denied.
7. **Seed: Zebronics brand + 42 products** from `data/ZebronicsPriceList.csv`, following seed-data.md exactly. For M1, generate a deterministic seed `.sql` (`insert ... on conflict (sku) do update ...`, so it's idempotent) and apply it via MCP. Rules that must hold: strip UTF-8 BOM + CRLF before parsing; category normalization + first-appearance display order; stable `ZEB-<CODE>-<NN>` SKUs; **preserve name typos** ("Balck", "Bannk", "Lighting", "Eare Phones") and only trim/collapse whitespace; `TBD → price_paise NULL`; whole-rupee `× 100 → paise`; reject any non-integer/negative/fractional price loudly. (The drift-protected idempotent `scripts/seed.ts` loader from the spec needs the Node/Next app, which isn't scaffolded yet — note it as a follow-up; do **not** block M1 on it. The first load into an empty table has no drift to guard against.)

## 3. Apply + verify loop (every migration)

1. Write `supabase/migrations/<ts>_<slug>.sql`.
2. MCP `apply_migration(project_id="ugjwcbxyyuowiyhczcrh", name="<slug>", query=<sql>)`.
3. Verify with MCP `list_tables` / `execute_sql` (structure exists, constraints present).
4. After the schema + RLS land, run MCP `get_advisors(project_id=..., type="security")` and **resolve every security finding** (RLS-disabled tables, `security definer` functions without a pinned `search_path`, exposed views, etc.). Re-run until the security advisors are clean. Also glance at `type="performance"`.
5. Commit the `.sql` (plus any spec edits) atomically with an accurate message.

## 4. Post-seed verification (must all pass — copy from seed-data.md)

```sql
select count(*) from products;                                   -- 42
select category, count(*) from products group by 1 order by 1;   -- Adaptors 4 / Adaptors with Cable 6 / Charging Cables 6 / Earphones 7 / Power Banks 5 / Speakers 14
select count(*) from products where price_paise is null;         -- 8
select min(price_paise), max(price_paise) from products;         -- 6000, 913800
select count(*) from products where sku !~ '^ZEB-(ADP|AWC|CBL|EAR|PWR|SPK)-\d{2}$';  -- 0
select count(*) from products where name ~ '(^\s|\s$|\s{2,})';   -- 0
```
Plus the RLS spot-check: a **salesman-authenticated** client selecting `products` returns exactly **34** rows, none with NULL price.

## 5. Security-definer hygiene (applies to `current_role()` and all 4 RPCs)

- Always set an explicit `search_path` on `security definer` functions (e.g. `set search_path = public, pg_temp`) — an empty/attacker-controlled search_path on a definer function is a privilege-escalation hole and `get_advisors` will (rightly) flag it.
- Do role/ownership/time checks **inside** the function body against `auth.uid()` and `now()`; raise a clear exception on violation so the RPC fails closed.

## 6. Acceptance criteria — M1 is done when

- All **7 tables** exist with RLS **enabled** (default deny) and exactly the matrix policies; `get_advisors(security)` is **clean**.
- The **4 RPCs** exist, are `security definer` with pinned `search_path`, and behave per §2.5 — including the idempotency, snapshot-preservation, and guard-interaction pins.
- The **4 triggers** (`touch_updated_at`, `recompute_order_total`, `guard_order_transition`, `create_profile_for_new_user`) are installed and interact correctly.
- Catalog seeded: **42 products (8 NULL price)**, brand `Zebronics`; every §4 query returns the stated value; salesman-auth `products` SELECT = **34**.
- The entire DB is reproducible from `supabase/migrations/*.sql` alone.
- **Hand the REVIEWER a test path:** the REVIEWER verifies by execution and needs authenticated clients per role. Provision (via the Dashboard/admin flow, not committed) one `salesman`, one `accountant`, and one `admin` test user, and record in the commit / a short `docs/` note how to authenticate as each (email + how the role was set) so the REVIEWER can run: the RLS 6-step protocol, the snapshot-preserving edit test (submit → change catalog price → edit qty → line keeps original price), the guard/trigger-interaction test, the idempotent-retry test, the qty-bound test, and the post-seed queries. Do **not** commit passwords.

## 7. Do NOT

- Run `supabase init`, start Docker, or add `config.toml` / a local DB.
- Use `float`/`numeric` in any money path.
- Trust client-supplied prices, totals, status, or clock.
- Delete-all-and-reinsert in `update_order_items` (breaks snapshot semantics).
- Expose `price_paise IS NULL` products to salesmen.
- Reduce `order_events` before/after payloads to bare `product_id`s (keep `sku`).
- Commit the `service_role` key or any password.
- Edit the REVIEWER's blocks in `comments.md`, or land new features on top of an unfixed ❌.
