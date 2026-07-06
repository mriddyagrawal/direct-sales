# Spec — Data Model

Source of truth for the Supabase (Postgres) schema. Migrations live in `supabase/migrations/*.sql` and must match this document; deviations require updating this spec in the same commit.

## Conventions

- Tables `snake_case`, plural. Primary keys `uuid` unless noted. All timestamps `timestamptz` (UTC); display/date-bucketing happens in `Asia/Kolkata`.
- **Money is integer paise** (`₹523` → `52300`). No floats, no `numeric` for money. Rendering uses `Intl.NumberFormat('en-IN')`.
- RLS is enabled on **every** table (default deny). Policies are specified in [roles-and-permissions.md](roles-and-permissions.md).
- **Drafts never touch the database.** An in-progress cart lives in the client (`localStorage`) and enters Postgres only via the `submit_order` RPC, already in status `submitted`. See [order-lifecycle.md](order-lifecycle.md) for why.

## Tables

### `profiles` — one row per staff login

```sql
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  role       text not null default 'salesman'
             check (role in ('admin', 'accountant', 'salesman')),
  active     boolean not null default true,
  username   citext unique
             check (username ~ '^[a-zA-Z0-9_.]{3,20}$'),
  created_at timestamptz not null default now()
);
```

Created automatically by a trigger on `auth.users` insert (default role `salesman`); the admin promotes roles via Supabase Studio. No self-signup (D3).

`username` (D9) is how staff **log in** — registration still happens by real email (D3), but the username is a separately-chosen identifier, never derived from the email. `citext` gives case-insensitive matching for free. Nullable: set from the admin-supplied user metadata (`{"username": "raju1"}`) at account-creation time by `create_profile_for_new_user`; if omitted there, set afterward in Studio the same way role promotion works — a `NULL` username simply can't sign in via the username-lookup path yet. See [roles-and-permissions.md](roles-and-permissions.md) for the login flow and the `email_for_username` RPC.

### `brands`

```sql
create table public.brands (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  active boolean not null default true
);
```

Seeded with `Zebronics`. Exists from day one so Phase 3 (multi-brand) is data, not migration.

### `products`

```sql
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands (id),
  category    text not null,        -- normalized display category, e.g. 'Speakers'
  name        text not null,        -- verbatim from price list (see seed-data.md)
  sku         text not null unique, -- stable internal code, e.g. 'ZEB-SPK-04'
  price_paise integer check (price_paise > 0),  -- NULL = unpriced → hidden from salesmen (D2)
  active      boolean not null default true,
  tally_name  text,                 -- exact Tally stock-item name; empty until Phase 2 mapping
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

`price_paise IS NULL` is the "TBD" state: visible to accountant/admin (so they can price it), invisible to salesmen — enforced by RLS, not UI.

### `retailers` — the party an order is for

```sql
create table public.retailers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  area              text,            -- locality / route hint, e.g. 'Sadar Bazaar'
  phone             text,
  verified          boolean not null default false, -- fail-closed: seed + accountant set true explicitly
  active            boolean not null default true,
  tally_ledger_name text,            -- exact Tally party-ledger name; Phase 2
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);
```

Every order references a retailer — this is what makes Phase 2 (Tally party ledgers) and Phase 4 (outstanding per shop) possible. Salesmen may quick-add a new shop in the field (`verified = false`); the accountant reviews and verifies. Ideally the initial list is seeded from a Tally ledger export so names already match (open question in [PLAN.md](../../PLAN.md)).

### `orders`

```sql
create sequence public.order_no_seq start with 1001;

create table public.orders (
  id             uuid primary key,          -- client-generated: makes submit idempotent
  order_no       integer not null unique,   -- from order_no_seq at submit
  order_ref      text not null unique,      -- 'ORD-2026-1042' (IST year of submission)
  retailer_id    uuid not null references public.retailers (id),
  salesman_id    uuid not null references public.profiles (id),
  status         text not null
                 check (status in ('submitted', 'processed', 'cancelled')),
  notes          text not null default '',
  total_paise    bigint not null,           -- cache; recomputed by trigger from items (bigint, like line totals)
  submitted_at   timestamptz not null,
  editable_until timestamptz not null,      -- submitted_at + edit window (default 2h)
  processed_at   timestamptz,
  processed_by   uuid references public.profiles (id),
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.profiles (id),  -- distinguishes a self-cancel from
                                                          -- an office-cancel (D8) — added M1.9
  updated_at     timestamptz not null default now()
);
```

`order_no` is unique and monotonic but **not gapless** (D1) — a rolled-back submit burns a number and that is fine; Tally assigns statutory invoice numbers. There is no `draft` status and no `locked` status: drafts are client-side, and "locked" is a **derived condition** (see lifecycle spec).

### `order_items` — immutable snapshots

```sql
create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid not null references public.products (id),
  product_name     text not null,     -- SNAPSHOT: copied from products at line write
  unit_price_paise integer not null,  -- SNAPSHOT: copied from products at line write
  qty              integer not null check (qty between 1 and 9999),  -- upper bound = fat-finger guard
  line_total_paise bigint  not null,  -- unit_price_paise * qty, computed server-side in bigint
                                      -- (9999 × ₹9,138 = 9.14e9 paise overflows int4)
  position         integer not null default 0,
  unique (order_id, product_id)
);
```

The snapshot pattern (verified in the owner's `quoteit` project): a future price-list update must never change what any historical order says. Snapshots are written by the RPCs from the **catalog row inside the same transaction** — client-supplied prices are never trusted.

### `order_events` — audit trail

```sql
create table public.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  actor_id   uuid references public.profiles (id),
  action     text not null,   -- see catalog in order-lifecycle.md
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

Append-only (no UPDATE/DELETE policies for anyone). This is the dispute-resolution trail ("who changed what, when") and, in Phase 5, the price-override trail.

## Write paths: RPC-only for orders

Salesmen and accountants have **no direct INSERT/UPDATE grants on `orders`/`order_items`**. All mutations go through `security definer` Postgres functions, so guards run inside the transaction and the client clock/state is never trusted:

| RPC | Caller | Does |
|---|---|---|
| `submit_order(id, retailer_id, notes, items[])` | salesman | Validates items (priced, active, qty 1–9999), snapshots names/prices from catalog, assigns `order_no`/`order_ref`, sets `submitted_at`/`editable_until`, writes `submitted` event. Idempotent on `id`: a retry carrying an existing `id` returns that order untouched — a differing payload is ignored, never merged. |
| `update_order_items(order_id, notes, items[])` | salesman (own, within window) or accountant | Replaces lines; existing lines keep their original snapshot price, newly added products snapshot at edit time; recomputes totals; writes event. |
| `cancel_order(order_id, reason)` | salesman (own, within window) or accountant | Sets status/`cancelled_at`/`cancelled_by`; writes event with reason. |
| `process_order(order_id)` | accountant/admin | `submitted → processed`; sets `processed_at/by`; writes event. |

## Triggers

| Trigger | Table | Purpose |
|---|---|---|
| `touch_updated_at` | `products`, `orders` | Keep `updated_at` fresh (pattern from `quoteit`). |
| `guard_order_transition` (BEFORE UPDATE) | `orders` | Reject illegal status transitions even from privileged code paths — defense in depth behind the RPCs. Note the trigger interaction: it must allow the internal `total_paise` write coming from `recompute_order_total` while still rejecting out-of-RPC status changes. |
| `recompute_order_total` (AFTER INSERT/UPDATE/DELETE) | `order_items` | `orders.total_paise = sum(line_total_paise)`; client totals are display-only. |
| `create_profile_for_new_user` | `auth.users` | Auto-insert `profiles` row, role `salesman`. |

## Indexes

```sql
create index orders_salesman_submitted_idx on public.orders (salesman_id, submitted_at desc);
create index orders_status_submitted_idx   on public.orders (status, submitted_at desc);
create index order_items_order_idx         on public.order_items (order_id);
create index order_events_order_idx        on public.order_events (order_id, created_at);
create index products_brand_category_idx   on public.products (brand_id, category, active);
```

## Invariants (the REVIEWER's checklist hooks here)

1. Every order row has `order_no`, `order_ref`, `submitted_at`, `editable_until` — no partial/draft rows exist, ever.
2. `orders.total_paise` always equals the sum of its items' `line_total_paise` (trigger-enforced).
3. Changing `products.price_paise` never changes any existing `order_items` row — verify by updating a price and re-reading an old order.
4. No float arithmetic anywhere in money paths.
5. `order_events` only ever grows.
