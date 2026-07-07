# Builder prompt — Phase 3a: fixed-price multi-brand order flow

## What this is
Make **fixed-price brands** (Zebronics + any other constant-price brand) properly orderable by salesmen: brand becomes a first-class order attribute, the Quick Order screen gets an in-context brand dropdown with lazy auto-lock, orders carry a **brand-coded ref**, and the dashboard can filter by brand. Design: [docs/phase3-multi-brand-design.md](../docs/phase3-multi-brand-design.md) — read **"Salesman brand selection"** + **"The one real schema change"** + **"Order refs — Option A"**.

## Scope guardrails (read first)
- **Fixed-price brands ONLY.** Do **NOT** build `pricing_mode`, manual/per-order pricing, `requires_approval`, approval, or the `pending_approval`/`approved` statuses — that's Phase 3b (LG).
- **Backward-compatible backend — do NOT change the `submit_order` / `update_order_items` call signatures.** Derive `orders.brand_id` from the order's items **server-side**. This is critical: the **currently-deployed `main` app keeps hitting the shared DB while the owner tests Zebronics**, so the RPCs must keep working for a client that sends no brand.
- **Shared-DB coordination (important).** There is ONE Supabase project — the same DB the owner is live-testing Zebronics against. Commit 1's migration is **additive + backward-compatible** (derived `brand_id`, unchanged signatures, `ORD-ZEB-…` refs), so it's safe to apply. **But the multi-brand UI (commit 2) needs a second brand to test** — provision a **disposable** test brand (e.g. "Luminous" + a few priced products) either on a **Supabase dev branch** or only when the owner is **not** mid-Zebronics-test, and **remove/deactivate it** afterward. Do not leave stray test data in the owner's live catalog (its products would otherwise show up in the owner's Quick Order).
- Money (integer paise), RLS, immutable-snapshot rules unchanged. Each commit compiles + runs; reviewer verifies by execution (desktop **and** phone).

## Current state
- `orders` has **no** `brand_id`; `brands` has **no** `code`. `products.brand_id` exists (all rows Zebronics). Verify exact shapes with `list_tables` before the migration.
- Salesman **Quick Order (S4)** shows all active priced products, **brand-agnostic**, grouped by category with **sticky navy category bars (live-measured offset)** — `src/app/new-order/QuickOrder.tsx`.
- The dashboard has a reusable **`FilterDropdown`** shell + a **`SalesmanFilter`** built on it (`src/app/dashboard/`) — **reuse that pattern** for the brand filter.
- `submit_order` / `update_order_items` live bodies: `update_order_items` is the **4-arg `p_reason`** version in `20260707T120000_update_order_items_reason.sql` (do not regress ㉘); the audit payload already emits `tally_name` (M5.5, ㉞).

---

## Commit 1 — Backend: brand as a first-class order attribute + guard + brand-coded ref
New migration `supabase/migrations/<ts>_multi_brand.sql` (MCP-applied, repo-tracked):
1. **`brands.code text`** — add, backfill Zebronics → `'ZEB'`, then `NOT NULL` + `unique`. (Note: any brand added afterward needs a `code` set — required for the ref.)
2. **`orders.brand_id uuid`** — add; backfill from each order's items (`select distinct p.brand_id … limit 1`; all existing = Zebronics); FK → `brands(id)`; then `NOT NULL`.
3. **`submit_order` (`create or replace`, SAME signature):** after existing line validation, compute the **distinct** `product.brand_id` across the lines → **raise** if more than one ("all items in an order must be the same brand"); set `orders.brand_id` to it; build `order_ref = 'ORD-' || b.code || '-' || <IST year> || '-' || order_no` (Option A: keep the single global `order_no_seq`).
4. **`update_order_items` (`create or replace`, SAME 4-arg `p_reason` body — copy the current one, don't regress ㉘):** guard that the post-edit line set stays single-brand **and** equals `orders.brand_id` (can't introduce a foreign-brand line).
5. Regenerate `src/lib/types/database.types.ts`.

**Historical refs are immutable** — existing orders keep `ORD-2026-xxxx`; only new orders get `ORD-ZEB-…`. (If the owner wants uniform historical refs, that's a separate, opt-in backfill — don't mutate stored refs here.)

**Acceptance:** an all-Zebronics submit → `orders.brand_id` set + ref `ORD-ZEB-2026-xxxx`; a crafted **mixed-brand** submit (two brands' products) → **rejected**; `update_order_items` adding a foreign-brand line → rejected, and its `p_reason`-after-lock guard still fires; existing orders backfilled to Zebronics; **a client that sends no brand (current `main`) still submits/edits fine** (signature unchanged); `npm run build` clean.

## Commit 2 — Quick Order brand UI (dropdown + hyper-category grouping + lazy auto-lock)
In `src/app/new-order/QuickOrder.tsx` (+ its module CSS):
- **Brand control:** a **plain OS `<select>` (NOT typable)** beside the search bar — shrink the search to fit. Default **"All brands"**. Only **active brands with ≥1 priced product**.
- **Hyper-category grouping (no per-item brand tag — rows stay dense):** in "All brands", nest **Brand ▸ Category ▸ items** (a bigger *Zebronics* section wrapping its `Speakers`/`Adaptors`/… sub-sections, then *Luminous*, …). **Two-tier sticky headers:** the brand header pins at top with a **heavier/distinct treatment above** the navy category bars; the category bar's live-measured sticky `top` must now **add the brand-header height** (nested sticky — the fiddly part).
- **Pick a brand ⇒ filter** to it; with one brand showing, the brand hyper-section collapses to **categories only**.
- **Add the first item (any qty) ⇒ auto-lock the brand:** the `<select>` snaps to that item's brand and **disables** (can't change while the cart holds items); the list filters to that brand. **Empty the cart ⇒ unlock.** Show a **subtle cue** when the list narrows on lock.
- **Submit is unchanged** — the server derives `brand_id` from the items (commit 1); the UI lock is pure UX, belt to the server's suspenders.
- **Testing:** provision a disposable second brand per the coordination guardrail.

**Acceptance:** "All brands" groups Brand ▸ Category with **both tiers sticky**; picking a brand filters (single-brand collapses to categories); adding the first item locks + disables the select + filters the list; emptying the cart unlocks; submitting lands the correct `brand_id` + `ORD-<code>-…` ref; works on a phone (search + brand control fit; sticky tiers don't overlap).

## Commit 3 — Surface brand: dashboard column/filter + pick slip + detail
- **Orders ledger (S8):** add a **BRAND** column and a **BrandFilter** built on the shared `FilterDropdown` (mirror `SalesmanFilter`); fold it into the two-stage scoped filter + tab counts.
- **Order detail** — salesman (S7) + accountant workbench (S9): show the order's brand.
- **Pick slip (S10):** brand in the header.

**Acceptance:** the ledger shows a BRAND column and filters by brand (counts + range + salesman still compose); the salesman + accountant detail views and the pick slip show the brand; `npm run build` clean.

## Commit 4 — Admin Products page (mobile): Brand ▸ Category sticky grouping + de-duplicated cards
Frontend-only — `src/app/dashboard/products/ProductsPricing.tsx` mobile **card** view + its CSS. Today each card repeats **brand · category · tally_name**, which is mostly redundant (tally defaults to the display name, so it echoes the card title; brand + category repeat on every row). Apply the **same Brand ▸ Category two-tier sticky grouping as commit 2's Quick Order** (share the helper/approach where practical):
- Group the mobile cards under **Brand ▸ Category** sticky headers — brand header heavier and above, category under it with its sticky `top` **offset by the brand-header height**. **Desktop table is unchanged** (its columns already avoid the redundancy).
- **Slim the card:** drop brand + category from the card body (now in the headers); show a **Tally line only when it differs** (`tally_name !== name`); keep display name + price + the inline **Active** toggle.
- Preserve M5.5's render-from-prop + row-click-edit + inline-active behaviour (flags ㉜🅐/🅑).

**Acceptance:** on a phone the Products list groups under sticky **Brand ▸ Category** headers (both tiers pin, no overlap); a card shows **no** repeated brand/category and **no** tally line when `tally == name`, but a **distinct** tally still shows; desktop table unchanged; row-click edit + Active toggle still work; `npm run build` clean.

---

## Guardrails recap
Fixed-price only (no LG/manual/approval). Backward-compatible RPCs (derive `brand_id` server-side, unchanged signatures — `main` keeps working on the shared DB). Provision + clean up any test brand carefully (shared live DB). Historical refs immutable. Reuse `FilterDropdown` for the brand filter. Reviewer verifies by execution, desktop + phone.
