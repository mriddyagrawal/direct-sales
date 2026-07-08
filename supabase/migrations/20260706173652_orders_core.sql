-- M1.3: orders core — order_no_seq, orders, order_items, order_events
-- Source of truth: docs/specs/data-model.md, docs/specs/order-lifecycle.md

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
  updated_at     timestamptz not null default now()
);

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

create table public.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  actor_id   uuid references public.profiles (id),
  action     text not null,   -- see catalog in order-lifecycle.md
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index orders_salesman_submitted_idx on public.orders (salesman_id, submitted_at desc);
create index orders_status_submitted_idx   on public.orders (status, submitted_at desc);
create index order_items_order_idx         on public.order_items (order_id);
create index order_events_order_idx        on public.order_events (order_id, created_at);
