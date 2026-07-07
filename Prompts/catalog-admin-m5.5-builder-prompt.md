# Builder prompt — M5.5 Catalog admin (Add product · Excel import)

## What this is
Let the **admin** grow the Products catalog two ways — a **manual Add/Edit modal** and a **brand-scoped Excel import** — on the dashboard **Products** page. Design: the Claude Design screens (ledger + 5b–5h). Full decisions: [docs/catalog-admin-design.md](../docs/catalog-admin-design.md) (read the "Resolutions — 2026-07-07 session 2" section first).

## Scope guardrails (read before starting)
- **Fixed-price brands only** (Zebronics + any other constant-price brand). **Do NOT build** manual/per-order pricing, `pricing_mode`, `requires_approval`, approval, or the "per order" price — the mocks show LG variants; **ignore them.** Phase 3.
- **Admin-only** for Add + Import (both INSERT products). Accountant keeps ledger + edit of price/`tally_name`/`active` on existing rows; **no Add/Import buttons for them.**
- **Money:** integer paise in the DB; **≤2 decimals accepted → paise, >2 rejected**; display via existing `formatRupees`.
- **Never delete/deactivate on import** — report untouched rows, don't touch them.
- **Upsert idempotent on `(brand_id, tally_name)`** — re-running the same file is a no-op.
- Stack: Next 16 App Router, React 19, CSS Modules, `@supabase/ssr`. Admin holds INSERT (`products_admin_insert`) + UPDATE (`products_staff_update`) + SELECT on products (no DELETE — there is no literal `ALL` policy), so the upsert runs through the admin's own session — no service role. Tokens/primitives: `Field`, `Button` in `src/components/ui/`, `formatRupees` in `src/lib/format.ts`, design tokens in `globals.css`.
- Each commit compiles and leaves the app runnable; the reviewer verifies by execution (desktop **and** phone).

## Current state (verified against the live DB)
`products`: `id, brand_id (FK, NOT NULL), category (text NOT NULL), name (text NOT NULL = display name), sku (text NOT NULL UNIQUE ← to drop), price_paise (int NULL, CHECK > 0), active (bool NOT NULL default true), tally_name (text NULL ← to make NOT NULL + unique), created_at, updated_at`. 42 rows, 34 priced, categories: Adaptors, Adaptors with Cable, Charging Cables, Earphones, Power Banks, Speakers. The current Products UI is `src/app/dashboard/products/ProductsPricing.tsx` (grouped card list, inline price edit; **renders straight from the `initialProducts` prop — preserve that pattern**, review flag ㉜🅐).

---

## Commit 1 — Backend: `tally_name` key, swap `sku`→`tally_name` in the audit trail, drop `sku`
New migration `supabase/migrations/<ts>_catalog_admin.sql`, applied via the Supabase MCP (repo-tracked, per project policy):
1. `update products set tally_name = name where tally_name is null;`
2. `alter table products alter column tally_name set not null;`
3. `alter table products add constraint products_brand_tally_key unique (brand_id, tally_name);`
4. **Swap the audit payload key — `update_order_items` ONLY** (reviewer ㉞, verified live). It is the **only** function that emits `sku`; `submit_order` / `process_order` / `cancel_order` emit **none** — do **not** touch them (recreating them risks a needless regression). Its **live** definition is the **4-arg `p_reason` body** in `20260707T120000_update_order_items_reason.sql`, which supersedes the 3-arg copies in `20260706T150400_rpcs.sql` and `20260706T150800_rename_current_role.sql` — **do NOT copy from those: they lack the mandatory-`p_reason`-after-lock logic (㉘) and copying them regresses it.** In the new migration, `create or replace function update_order_items(...)` from that **current 4-arg body verbatim**, changing only its **two** `jsonb_build_object('sku', p.sku, …)` sites to `jsonb_build_object('tally_name', p.tally_name, …)`.
5. `alter table products drop column sku;` (drops the column + its unique constraint). Remove any `sku ~ '^ZEB-'` post-seed check if present.
6. Regenerate `src/lib/types/database.types.ts` (MCP `generate_typescript_types`).
7. **Keep the app compiling:** `ProductsPricing.tsx` L155 renders `{p.sku}` and `page.tsx` selects `sku` — remove those minimal references now (full ledger rework is commit 2).
8. Docs: update the event catalog in [docs/specs/order-lifecycle.md](../docs/specs/order-lifecycle.md) (`before`/`after` = `{ tally_name, qty, unit_price_paise }`) and the `tally_name` note in [docs/specs/seed-data.md](../docs/specs/seed-data.md).

**Acceptance:** migration applies; a submitted **and edited** test order works end-to-end and the **edit** now emits `tally_name` (not `sku`) in its `order_events` row — `submit_order` is unchanged (it never emitted `sku`) and its `p_reason`-after-lock guard (㉘) still fires; `products` has no `sku`; `unique(brand_id, tally_name)` rejects a dup; types regenerated; `npm run build` clean.

## Commit 2 — Products ledger table
Rework the Products page into the ledger from screen 1 (this replaces the grouped card list):
- Columns: **# · BRAND · CATEGORY · DISPLAY NAME · TALLY NAME · PRICE · ACTIVE**. Reuse the S8 grammar (hairlines, mono figures, muted metadata via `--color-locked`, bold display name). Header: **"Products · N products · M priced"** (not "SKUs").
- **PRICE**: `formatRupees` when set, muted **TBD** when `price_paise IS NULL` (D2). No "per order" (Phase 3).
- **ACTIVE**: inline toggle that writes `active` (admin+accountant). Keep the render-from-prop + stay-busy-through-`router.refresh()` patterns from the current component (flags ㉜🅐/🅑).
- Show all brands' rows (BRAND column); Zebronics-only today, but don't hardcode it.

**Acceptance:** ledger renders all products with the right columns; unpriced = TBD; inline ACTIVE toggle persists + reflects after refresh; matches the S8 look; build clean.

## Commit 3 — Add / Edit product modal (shared form)
One modal (Field/Button primitives, centered on desktop / bottom-sheet on phone per 5b/5c):
- **Brand** (dropdown of `brands`, required) · **Category** (see below) · **Display name** (required) · **Tally name** (optional) · **Price** (optional) · **Active** (default on).
- **Category = brand-scoped typeahead combobox**, **disabled until a brand is chosen**; type to filter that brand's existing categories, or type a new one ("+ NEW" path). **Normalize on save:** trim + case-insensitive match, so "speakers" folds into an existing "Speakers" (store the canonical existing spelling; else the entered value).
- **Tally name blank ⇒ write the display name into `tally_name`** at save (never store blank/`—`).
- **Price:** accept up to 2 decimals → paise (`₹557.5` → `55750`); **reject >2 decimals** ("Price can have at most 2 decimal places") and non-numeric; blank ⇒ TBD. **Replace the old whole-rupee validation** (`/^\d+$/`) with this everywhere.
- **Add** ("+ Add product", **admin-only** button): opens empty modal → **upsert on `(brand_id, tally_name)`** (existing ⇒ update, per owner). Validation error = red strip + red field (never amber), per 5c.
- **Edit**: **row-click** opens the same modal pre-filled ("Edit product") → UPDATE. Accountant sees name+category **read-only** (price/tally/active editable); admin sees all fields. (Hide the Add button for accountant.)

**Acceptance:** admin adds a product → appears in the ledger; adding a dup `(brand, tally)` updates instead of duplicating; blank tally stores the display name; blank price = TBD; `₹557.5` stores 55750, `₹557.555` rejected; row-click edits; category dropdown is disabled until brand chosen, filters by brand, and "speakers"→"Speakers" normalizes; accountant has no Add button and can't edit name/category; build clean.

## Commit 4 — Excel import wizard
"Import" button (**admin-only**) → 3-step overlay (Upload → Preview → Result), phone = full-screen sheet. Add the **SheetJS `xlsx`** dep.
- **Step 1 Upload (5d):** brand selector (**one brand per file**), drag/drop or choose `.xlsx`, expected columns `Category · Display Name · Tally Name · Price · Active`, **Download template** (SheetJS-generated `.xlsx` with the header + one example row).
- **Parse + diff (client-side):** read the first sheet, trim blank rows, coerce Price. Fetch the brand's current products; classify each row against **`(brand_id, effective tally_name)`** where effective = Tally Name cell, else Display Name:
  - **New** (key absent) · **Updated** (key present) · **Error** (missing display name; price >2 decimals or non-numeric; category blank).
- **Step 2 Preview (5e/5f):** New·X / Updated·Y / Errors·Z summary (accent / ink-grey / **red** squares — no amber); per-row table with status; **error rows red-edged (3px left) + inline reason**; **untouched-count line** ("N products already in the catalog aren't in this file — left untouched (deactivate discontinued ones manually)"). Apply button **degrades honestly**: clean ⇒ "Apply import · N rows"; with errors ⇒ "Apply K valid rows" + "Z error rows will be skipped".
- **Apply:** upsert the **valid** rows on `(brand_id, tally_name)` (blank tally ⇒ display name) via the admin session — prefer a Server Action / RPC applying them **atomically**; **idempotent** (re-run = all Updated). Progress state ("Applying… don't close"), then **Result (5g):** Added / Updated / Skipped counts + Done.
- **Unreadable file (5g):** "Couldn't read this file — not a valid .xlsx or columns don't match" + Download template.
- **Phone (5h):** wide preview table scrolls **inside its own bordered container** (page body never scrolls sideways); primary action pinned full-width.

**Acceptance:** admin imports a `.xlsx` → preview New/Updated/Errors keyed on `(brand, effective-tally)` is correct; error rows skipped, valid rows applied; **re-running the same file = all Updated, zero duplicates**; products absent from the file are untouched (never deactivated); template downloads and re-imports clean; unreadable file shows the error state; accountant has no Import button; phone table scrolls in-container; build clean.

---

## Guardrails recap
No manual-pricing / approval / `pricing_mode` / brand-code / order-flow changes (all Phase 3). Add + Import are admin-only. Never delete on import. Upsert idempotent on `(brand_id, tally_name)`. Money ≤2 decimals → paise. Preserve render-from-prop + stay-busy-through-refresh. Reviewer verifies by execution, desktop + phone.
