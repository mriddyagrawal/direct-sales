-- M1.2: catalog tables — brands, products, retailers
-- Source of truth: docs/specs/data-model.md

create table public.brands (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  active boolean not null default true
);

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

create index products_brand_category_idx on public.products (brand_id, category, active);
