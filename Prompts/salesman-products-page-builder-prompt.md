# Builder prompt — Salesman "Products" page (read-only pricelist + stocklist + search)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-23** · designed with the owner. **New salesman route + shared grouping util. FE-only — NO DB migration, NO RLS change, NO new fetch privileges (reads the salesman's existing catalog scope).**

## What & why
The salesman already sees price/stock/search inside Quick Order, but only *as an order flow* (must pick a retailer, cart locks to one brand). This is a **pure read-only reference** he can pull up mid-conversation to look up a price or check stock — no retailer, no cart, no editing. Owner-locked design (2026-07-23):
- A **new "Products" tab** in the salesman bottom bar → `/products`.
- **Search + brand filter + Brand▸Category stock-first grouping** (the same sort just shipped in Quick Order, b5e446f).
- **Two-line row:** name (`model・display` per the Quick Order standard) · **price** (`₹` if the product has one, else an em dash `—`) · **stock** (`N in stock` / `out of stock`).
- Read-only. v1 is reference only — **no** "start order" / "copy" affordances.

## De-dup (the point the owner raised) — extract the grouping into one shared util
The stock-first grouping currently lives *inside* [QuickOrder.tsx](../src/app/new-order/QuickOrder.tsx) (`toCategoryGroups` + the per-brand in/out partition, added in b5e446f). **Move it to `src/lib/product-grouping.ts`, generic over a minimal shape, and have BOTH Quick Order and the new page import it** — one copy of the sort rules forever.

```ts
// src/lib/product-grouping.ts
export interface StockGroupable {
  category: string;
  name: string;
  brand_id: string;
  brand_name: string;
  stock_qty: number | null;
}
export interface StockCategoryGroup<T> { category: string; outOfStock: boolean; products: T[]; }
export interface StockBrandGroup<T> { brandId: string; brandName: string; categories: StockCategoryGroup<T>[]; }

// In-stock (stock_qty>0) categories A→Z first, then "(out of stock)" (0 or null)
// categories A→Z; products A→Z by name within each. Identical to QuickOrder b5e446f.
export function groupProductsStockFirst<T extends StockGroupable>(visible: T[]): StockBrandGroup<T>[] {
  function toCategoryGroups(list: T[], outOfStock: boolean): StockCategoryGroup<T>[] {
    const byCat = new Map<string, T[]>();
    for (const p of list) {
      const arr = byCat.get(p.category) ?? [];
      if (arr.length === 0) byCat.set(p.category, arr);
      arr.push(p);
    }
    return [...byCat.entries()]
      .map(([category, ps]) => ({ category, outOfStock, products: [...ps].sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }
  const byBrand = new Map<string, { brandName: string; products: T[] }>();
  for (const p of visible) {
    let bg = byBrand.get(p.brand_id);
    if (!bg) { bg = { brandName: p.brand_name, products: [] }; byBrand.set(p.brand_id, bg); }
    bg.products.push(p);
  }
  return [...byBrand.entries()]
    .map(([brandId, bg]) => {
      const inStock = bg.products.filter((p) => (p.stock_qty ?? 0) > 0);
      const outStock = bg.products.filter((p) => (p.stock_qty ?? 0) <= 0);
      return { brandId, brandName: bg.brandName, categories: [...toCategoryGroups(inStock, false), ...toCategoryGroups(outStock, true)] };
    })
    .sort((a, b) => a.brandName.localeCompare(b.brandName));
}
```
Then in **QuickOrder.tsx**, delete the local `toCategoryGroups` + the `brandGroups` body and call `groupProductsStockFirst(visible)` (its `ProductOption` already satisfies `StockGroupable`; keep its local `CategoryGroup`/`BrandGroup` or alias them to the shared generics — `renderCategory`/`renderProduct` stay untouched). **QuickOrder's rendered output must be byte-identical to b5e446f** — this is a pure move, not a behavior change (the REVIEWER re-runs the b5e446f invariant check against it).

Optional (nice, not required): also share `normalize` + the `matchesSearch` predicate.

## The new route
**`src/app/products/page.tsx`** (server component) — mirror the Quick Order catalog fetch ([new-order/page.tsx:76-91](../src/app/new-order/page.tsx#L76)), same RLS-scoped select, no retailer:
```ts
supabase.from("products")
  .select("id, category, name, tally_name, price_paise, brand_id, stock_qty, stock_updated_at, brands(name, show_model)")
  .order("category");
```
Map to a `ProductRow` (id, category, name, tally_name, price_paise, brand_id, brand_name, show_model, stock_qty, stock_updated_at) — same fields Quick Order's `ProductOption` carries minus `pricing_mode`. Render the phone shell: `<TopStrip …/>` + `<ProductsBrowse products={…}/>` + `<BottomTabBar/>` (same wrapper as [page.tsx](../src/app/page.tsx)). Get the salesman's name for TopStrip the same way home does.

**`src/app/products/ProductsBrowse.tsx`** (client) — read-only:
- **Sticky search input** + **BrandFilter** (reuse [BrandFilter](../src/components/orders/BrandFilter.tsx)); brand-tier headers when "all brands", flat when one brand is picked — same pattern as Quick Order.
- **"Stock as of <t>"** line above the list: `t` = the most recent `stock_updated_at` across products (reuse `formatShortDate` from `@/lib/format`, matching Quick Order's "as of" voice); omit if none synced.
- Build groups with `groupProductsStockFirst(visible)`; render sticky **brand** and **category** headers (category label `= group.outOfStock ? `${category} (out of stock)` : category`), exactly like Quick Order.
- **Two-line row** per product:
  - Line 1 — name using the **Quick Order standard** ([QuickOrder.tsx:237](../src/app/new-order/QuickOrder.tsx#L237)): `show_model && tally_name && tally_name !== name ? <span>{tally_name}</span>・{name} : name`.
  - Line 2 — **price**: `price_paise != null ? formatRupees(price_paise) : "—"` · **stock pill**: `stock_qty != null && stock_qty > 0` → green dot + `{stock_qty} in stock`; else red dot + `out of stock` (null counts as out — same rule as Quick Order / the order-time pill). Reuse the stock-pill visual (`--color-processed` green / `--color-error` red, 7px dot) from [QuickOrder.module.css](../src/app/new-order/QuickOrder.module.css#L324) `.stockPill`/`.stockIn`/`.stockOut`.
- **Empty-search state** ("No products match …" + clear) like Quick Order. No cart bar, no stepper, no keypad, no price inputs — this component never mutates.

## Nav
Add a third tab to **[BottomTabBar.tsx](../src/components/BottomTabBar.tsx)**: `Products` → `/products`, active when `pathname === "/products"`. Icon: a lucide catalog/price glyph (`Tag` or `PackageSearch`); use `Glyph` like the others. Update the file's header comment (it currently says "Orders · Deposits").

## Acceptance (REVIEWER verifies by execution)
- `/products` renders for a salesman: search + brand filter + "Stock as of …", Brand▸Category **stock-first** (in-stock categories, then `(out of stock)`), everything A→Z.
- Row shows name in the `model・display` standard (a Bajaj/LG row shows tally + display; a Zebronics row just the name), price `₹…`/`—`, and `N in stock`/`out of stock`.
- A priced product (Zebronics) shows `₹`; an unpriced manual product (most LG) shows `—`; an in-stock item shows its count; a 0/null item shows "out of stock".
- Search finds by name / model / category / brand and still splits in/out.
- **Quick Order is visually unchanged** (grouping identical after the util extraction) — verify build + the b5e446f grouping invariants still hold.
- Bottom bar shows 3 tabs, Products active on `/products`; Orders/Deposits unchanged.
- `tsc` / `eslint` / `build` clean.
- Commit: `feat(products): read-only salesman Products page (pricelist + stocklist + search) + shared stock-first grouping util`.

## Guardrails
- **No DB / migration / RLS / RPC.** Read-only page over the existing salesman catalog scope. If a needed field isn't returned by the salesman's product RLS, STOP and flag it — do not add a policy.
- The grouping extraction is a **pure move** — Quick Order behavior must not change. Don't "improve" the sort while moving it.
- Money stays paise → `formatRupees`; null price → `—`, never `₹0` or `₹NaN`.
- **Scale note (leave a comment):** client-side browse, correct only under the PostgREST row cap (752 now, cap 3000); the DB-side search/virtualization for this page + Quick Order + staff products converges in the Bajaj perf pass — not here.
- Read the newest `comments.md` review blocks first. Commit message literally accurate — the REVIEWER verifies by execution.
