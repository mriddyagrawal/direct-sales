# Catalog admin — add & import products (design note)

**Status:** design captured 2026-07-07, **not built.** Admin-only for now (accountant maybe later). Relates to [phase3-multi-brand-design.md](phase3-multi-brand-design.md) (brand-sensitive, `pricing_mode`) and **settles the open SKU question** (below).

## Why
Today products only enter via the CSV **seed script**; the in-app Products tab can price/edit existing rows but can't **add** new products. The owner wants the admin to add items two ways — one at a time, and by bulk CSV/Excel import — **brand-scoped, upserting (never duplicating)**.

## Path 1 — Manual single add  (Products tab → "+ Add product", admin-only)
- **Brand** (required, dropdown)
- **Category** (required — dropdown of the brand's existing categories + "add new")
- **Display name** (required)
- **Tally name** (optional → **blank copies the display name**)
- **Price** (optional, ₹ whole rupees → integer paise; blank = TBD/unpriced per D2. Moot for a `manual`-pricing brand like LG — hide/disable it there)
- **Active** (default true)

Writes via the admin's own session — RLS already gives admin `ALL` on products, so **no service-role** needed. Upsert, not blind insert: a matching key updates instead of duplicating.

## Path 2 — CSV / Excel import  (Products tab → "Import", admin-only)
- **Brand-scoped:** pick the target brand in the UI; every row goes to that brand (**one brand per file** — simplest, avoids a brand-column mismatch).
- **Columns** (header row, order-independent):

  | Column | Required | Notes |
  |---|---|---|
  | `Category` | ✔ | matched/created within the brand |
  | `Display Name` | ✔ | |
  | `Tally Name` | — | blank ⇒ = Display Name |
  | `Price` | — | whole ₹; blank ⇒ TBD; ignored for manual-pricing brands |
  | `Active` | — | TRUE/FALSE, default TRUE |

- **Upsert, never duplicate:** match on the key (below); existing ⇒ update all columns, new ⇒ insert.
- **Never deletes:** rows in the DB but absent from the file are **reported** ("N products not in this file — deactivate manually if discontinued"), not removed (same safety rule as the seed).
- **Dry-run preview:** before applying, show **X new / Y updated / Z errors** with per-row reasons; apply **transactionally** (all-or-nothing) so a bad file can't half-corrupt the catalog.
- **Excel (.xlsx)** needs a server-side parser (SheetJS `xlsx`); CSV is trivial. Runs in a Server Action with the admin's session. Ship a **downloadable template** (header row + one example).

## The upsert key — this settles the SKU question
The key must be stable, present on every row, unique within a brand. Options:
- **(brand_id, tally_name) — recommended.** The import source is a **Tally export**, so the Tally stock-item name is the natural key the file already carries; and "blank tally_name ⇒ display name" means it's always populated. Caveat: editing an item's tally_name later changes its identity for future imports (acceptable — the admin controls both sides).
- (brand_id, display name) — keeps tally_name a pure optional field, but renames break re-import matching just the same.
- keep the invented `sku` — most stable, but it's a code we made up (not a real part number) and nobody uses it.

**Recommendation:** upsert on **(brand_id, tally_name)** and **drop the generated `sku`** (or make it nullable) — the concrete answer to the earlier SKU thread. Requires:
- `tally_name` → **NOT NULL, default = display name** (backfill existing Zebronics: `tally_name = name`), plus **`unique(brand_id, tally_name)`**.
- Update the Products list (drop the sku line / show tally_name), the salesman search (name, or name+tally_name), and retire the seed script's `sku`-based upsert + the `sku ~ '^ZEB-'` post-seed check.
- **Revises seed-data.md** ("tally_name empty until Phase 2") — tally_name now defaults to the display name, admin corrects as needed. Fine at this scale; record the decision when built.

## Notes / relationships
- **Retires the CLI seed script?** This in-app import does the same job (CSV → products, upsert), so it can subsume the seed loader (flag ⑬). One difference of intent: the CLI loader *warned* before overwriting an in-DB price; the admin import **intentionally overwrites** (owner: "overwrite any items") — so **no drift-protection** here, the admin is in control.
- **Admin-only** (owner). Accountant has UPDATE (can price) but not INSERT; revisit if they should add items.
- For `manual`-pricing brands the catalog price is moot — hide the Price field/column.

## Decisions (owner-confirmed 2026-07-07)
1. **Upsert key = `(brand_id, tally_name)`** ✓ — and **drop the invented `sku`** ✓. Requires `tally_name` → NOT NULL default = display name (backfill Zebronics), `unique(brand_id, tally_name)`.
2. **Category = simple** ✓ — text with a dropdown-of-existing + "add new"; **no `categories` table for now** (revisit only if controlling the salesman-facing category *order* becomes a real need).
3. **Import preview / dry-run: build it** ✓ (New / Updated / Errors summary + per-row table; "apply the valid rows" when errors exist).
4. **Excel (.xlsx) primary** ✓ — SheetJS server-side (parses CSV too, for free). Cleaner than CSV (no BOM/encoding hazards); read the first sheet, trim blank rows, coerce the Price cell (number-or-text). Cap file size.

UI: **manual add = small modal; import = large overlay/sheet** (needs the preview table). Both on the admin **Products** page. Claude Design brief: [Prompts/products-admin-design-prompt.md](../Prompts/products-admin-design-prompt.md).

## Resolutions — owner review of the Claude Design output (2026-07-07, session 2)
These settle the open points and **supersede** any conflicting text above. Builder prompt: [Prompts/catalog-admin-m5.5-builder-prompt.md](../Prompts/catalog-admin-m5.5-builder-prompt.md).

- **Scope = Zebronics + other *fixed*-price brands only.** NO manual-pricing / `pricing_mode` / `requires_approval` / approval / "per order" / LG — all Phase 3. The design mocks show LG rows + "per order"; **don't build those.** Use the existing `products.brand_id`.
- **`sku` drop has a backend dependency (do it first).** The order RPCs build `order_events` payloads `jsonb_build_object('sku', p.sku, …)` in **4 places** — `20260706T150400_rpcs.sql` (L166, L219) and `20260707T120000_update_order_items_reason.sql` (L77, L127). Migration must **swap those to `tally_name`** (recreate the functions), update the event catalog in [specs/order-lifecycle.md](specs/order-lifecycle.md) (`{ tally_name, qty, unit_price_paise }`), **then** drop `sku`. Old events keep their `sku` key; new ones carry `tally_name`.
- **Match key = `(brand_id, tally_name)` only** — no display-name-fallback *matching*. `tally_name` is always populated: blank on input ⇒ **write the display name into `tally_name` at save time** (so the ledger shows the real value, never "—"). New key ⇒ insert; existing ⇒ update; same⇒same is a harmless no-op (the 40+10-from-Tally case).
- **Price = up to 2 decimals ⇒ paise; reject >2 decimals** (message: "Price can have at most 2 decimal places"). ₹557.5 is valid (55 750 paise). Blank ⇒ TBD (D2). **Also fix the existing `ProductsPricing.save()` whole-rupee validation** (`/^\d+$/`, ×100) to match.
- **Category = brand-scoped typeahead combobox**, **grayed out until a brand is chosen**, type-to-filter that brand's existing categories or type a new one; **normalize on save** (trim + case-insensitive dedupe so "speakers" folds into existing "Speakers").
- **Edit existing = row-click → the same modal as Add, pre-filled** ("Edit product"). Keep the **ACTIVE toggle inline** in the ledger. Accountant: price/tally/active editable, name/category read-only; admin: all fields. (Replaces the current inline edit-card.)
- **Manual add of a duplicate `(brand, tally_name)` ⇒ upsert (update)** — same engine as import.
- **Import apply = the valid rows (atomically), error rows skipped** (honest degrade, per mock 5f "Apply K valid rows · Z skipped"), **idempotent** (re-run = all Updated, no dups), **never deletes** (untouched-count line). Parse `.xlsx` with SheetJS.
- **Admin-only** for both Add + Import (INSERT via `products_admin_insert`); accountant = ledger + UPDATE (price/tally/active), no Add/Import. Recorded in [specs/roles-and-permissions.md](specs/roles-and-permissions.md).
- **Wording:** "N products", not "N SKUs" (the `sku` field is gone).
