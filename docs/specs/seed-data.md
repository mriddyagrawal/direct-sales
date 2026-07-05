# Spec — Seed Data (CSV → database)

How [data/ZebronicsPriceList.csv](../../data/ZebronicsPriceList.csv) becomes rows in `products`. The CSV is the **initial** source of truth; after seeding, the database is the working source (TBD pricing, revisions) and the CSV is never hand-edited.

## Source file facts (verify before seeding)

- 43 lines: 1 header (`Brand,Type,Product,Price`) + **42 products**, all `Zebronics`.
- Categories ("Type") and counts: ADAPTOR (4), Adaptor with Cable (6), Charging Cable (6), Eare Phones (7), Power Bank (5), SPEAKER (14).
- **8 rows have `Price = TBD`** (2 earphones, 2 power banks, 4 speakers). Priced range: ₹60–₹9,138, whole rupees.
- Known data quirks, preserved deliberately (see name policy): "Eare Phones", "Balck", "Bannk", "Lighting", doubled/stray spaces.

## Transformation rules

| Rule | Detail |
|---|---|
| **Brand** | Upsert `brands` row `Zebronics`; all products reference it. |
| **Category normalization** | Display categories: `ADAPTOR → Adaptors`, `Adaptor with Cable → Adaptors with Cable`, `Charging Cable → Charging Cables`, `Eare Phones → Earphones`, `Power Bank → Power Banks`, `SPEAKER → Speakers`. Category display order = CSV first-appearance order. |
| **SKU generation** | `ZEB-<CODE>-<NN>`: codes `ADP`, `AWC`, `CBL`, `EAR`, `PWR`, `SPK`; `NN` = 2-digit position within category in CSV row order (`ZEB-SPK-04` = ASTRA 40). SKUs are **stable forever** — they are the upsert key and future Tally-mapping anchor. |
| **Name policy** | Verbatim from CSV except: trim ends, collapse internal whitespace runs. **Typos are preserved** ("Balck", "Bannk", "Lighting") — they may mirror the accountant's Tally stock-item names, and guessing wrong makes Phase 2 mapping worse. Display names may be cleaned later, *after* cross-checking Tally masters; `tally_name` will hold the exact Tally string (open question in [PLAN.md](../../PLAN.md)). |
| **Price** | `TBD` → `price_paise = NULL` (hidden from salesmen, D2). Otherwise whole-rupee integer × 100 → paise (`523` → `52300`). Reject anything else (non-numeric, negative, fractional) loudly. |
| **Flags** | `active = true` for all; `tally_name = NULL`. |

## Script contract (`scripts/seed.ts`)

- Runs with `SUPABASE_SERVICE_ROLE_KEY` from env (never committed); parses `data/ZebronicsPriceList.csv`.
- **Idempotent, upsert by `sku`**, with one hard rule: **a re-run never silently overwrites a non-NULL `price_paise` in the DB with a different CSV value** — it prints a drift warning and skips (`--force-prices` to override). The DB is the working truth after go-live; drift is flagged, not clobbered (this is also the TESTER's "catalog integrity" check).
- Never deletes: SKUs missing from a future CSV are reported (candidates for `active = false`), not removed.
- Prints a summary: inserted / updated / price-drift / unpriced counts.
- Multi-brand ready (Phase 3): same pipeline, new CSV in `data/`, brand-specific SKU prefix.

## Post-seed verification (run after every seed)

```sql
select count(*) from products;                                   -- 42
select category, count(*) from products group by 1 order by 1;   -- 4/6/6/7/5/14 per mapped names
select count(*) from products where price_paise is null;         -- 8
select min(price_paise), max(price_paise) from products;         -- 6000, 913800
select count(*) from products where sku !~ '^ZEB-(ADP|AWC|CBL|EAR|PWR|SPK)-\d{2}$';  -- 0
select count(*) from products where name ~ '(^\s|\s$|\s{2,})';   -- 0 (whitespace rule)
```

And one RLS spot-check: a salesman-authenticated client selects products → exactly **34** rows, none with NULL price.
