# Builder prompt — Quick Order: stock-first grouping (in-stock categories, then "(out of stock)" categories)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-21** · grounded against the live Quick Order screen. **FE-only — pure render-time regroup of the already-loaded catalog. NO DB migration, NO fetch change.**

## What & why
Quick Order loads the whole catalog (752 active+priced products today; **140 in stock, ~600 out/never-synced**) and groups it **Brand ▸ Category ▸ product** ([QuickOrder.tsx:133-153](../src/app/new-order/QuickOrder.tsx#L133) builds `brandGroups`, [renderCategory:299](../src/app/new-order/QuickOrder.tsx#L299) renders each). Within a category, in-stock and out-of-stock items are mixed in creation order, so the few orderable items are buried.

Owner wants **in-stock items to float to the top of each brand**, without adding a third header level. The mechanism (owner-locked 2026-07-21): split each category **by stock** at render time so a category renders **up to twice within a brand** — once for its in-stock items (plain header), once for its out-of-stock items (`(out of stock)` header). All in-stock categories come first, then all out-of-stock categories.

```
▸ LG                              (brand header — unchanged, A→Z)
   Air Conditioners               (category header — plain = in-stock block)
     …in-stock ACs (name A→Z)
   Refrigerators
     …in-stock fridges
   Air Conditioners (out of stock)  (same category, out-of-stock block)
     …out-of-stock/never-synced ACs
   Refrigerators (out of stock)
     …
```

## Owner-locked rules
- **Split line:** in-stock = `stock_qty > 0`. The `(out of stock)` block = `stock_qty = 0` **OR** `stock_qty` null (never-synced — e.g. LG's 511 unsynced items — belong here; "no stock" ⇒ out block).
- **Order, all alphabetical:** brands A→Z (already the case), categories A→Z **within each block**, products A→Z **by name** within each category (today it's creation order — change it).
- **Within a brand, in-stock block first, then out-of-stock block.**
- **Headers:** out-of-stock category header = `{Category} (out of stock)`. In-stock header = the **plain** category name — do **not** add "(in stock)" (the green per-row stock pill already signals it; the suffix would just be noise).
- **No new sticky/divider level** — the only sticky headers stay brand + category, exactly as now. The `(out of stock)` suffix on the category header is the sole stock cue.
- Applies uniformly to **every brand** (manual brands included — EOL is 40/41 in stock, so they split naturally; there is no manual-brand exception).

## Implementation (client-side only)
1. **`CategoryGroup` type** ([QuickOrder.tsx:19](../src/app/new-order/QuickOrder.tsx#L19)) — add a flag:
   ```ts
   interface CategoryGroup { category: string; outOfStock: boolean; products: ProductOption[]; }
   ```
2. **Rebuild `brandGroups`** ([QuickOrder.tsx:133-153](../src/app/new-order/QuickOrder.tsx#L133)) from `visible` — partition each brand's products into in-stock / out-of-stock, then group+sort each partition, then concat (in first). Suggested shape:
   ```ts
   function toCategoryGroups(list: ProductOption[], outOfStock: boolean): CategoryGroup[] {
     const byCat = new Map<string, ProductOption[]>();
     for (const p of list) {
       const arr = byCat.get(p.category) ?? [];
       if (arr.length === 0) byCat.set(p.category, arr);
       arr.push(p);
     }
     return [...byCat.entries()]
       .map(([category, ps]) => ({
         category, outOfStock,
         products: [...ps].sort((a, b) => a.name.localeCompare(b.name)),   // items A→Z
       }))
       .sort((a, b) => a.category.localeCompare(b.category));               // categories A→Z
   }
   // per brand:
   const inStock  = brandProducts.filter((p) => (p.stock_qty ?? 0) > 0);
   const outStock = brandProducts.filter((p) => (p.stock_qty ?? 0) <= 0);   // 0 AND null → out
   const categories = [...toCategoryGroups(inStock, false), ...toCategoryGroups(outStock, true)];
   // then brands A→Z: .sort((a, b) => a.brandName.localeCompare(b.brandName))
   ```
   Build it from `visible` (the search+brand-filtered list) so **search results split the same way**. Memoize `visible` (`useMemo` on `[products, q, effectiveBrand]`) and key `brandGroups` off `[visible]` to avoid recomputing every render (the current `eslint-disable` deps hack can go).
3. **`renderCategory`** ([QuickOrder.tsx:299-309](../src/app/new-order/QuickOrder.tsx#L299)) — label + unique key (a category now appears twice):
   ```tsx
   <section key={`${group.category}__${group.outOfStock ? "out" : "in"}`}>
     <div className={styles.categoryHeader}>
       <span>{group.outOfStock ? `${group.category} (out of stock)` : group.category}</span>
       <span>{group.products.length}</span>
     </div>
     {group.products.map(renderProduct)}
   </section>
   ```
   Both render paths ([the `showBrandTier` brand map:380](../src/app/new-order/QuickOrder.tsx#L380) and the flat [`allCategories`:387](../src/app/new-order/QuickOrder.tsx#L387)) call `renderCategory`, so both pick this up automatically. `allCategories = brandGroups.flatMap(bg => bg.categories)` stays as-is.
4. **`renderProduct` is unchanged** — the per-row green/red stock pill already matches each block; leave it.

Optional (not required): a muted tone on the `(out of stock)` header via a modifier class. Only if trivial and it doesn't fight the sticky style — the label alone is the spec.

## Acceptance (the REVIEWER verifies by execution)
- Inside a brand: in-stock categories (A→Z, plain headers) render **above** the out-of-stock categories (A→Z, `(out of stock)` headers).
- Brands A→Z; categories A→Z in each block; products A→Z by name in each category.
- An item with `stock_qty > 0` → in-stock block; `stock_qty = 0` **or null** → out-of-stock block (spot-check an LG null-stock item lands under `(out of stock)`, and an EOL in-stock item lands in the plain block).
- Typing a search term filters, then still splits in/out the same way; picking/locking a brand still scopes correctly; brand-tier (all brands) and single-brand views both show the split.
- Per-row stock pills unchanged; the empty-search and "no longer orderable" sections unchanged.
- `tsc` / `eslint` / `build` clean.
- Commit: `feat(new-order): Quick Order stock-first grouping — in-stock categories then "(out of stock)" categories per brand, all alphabetical`.

## Guardrails
- **FE-only.** No DB migration, no query change, no server search — this is a pure client regroup of the already-fetched array.
- **Scale note (leave a code comment):** this is correct only while the catalog fits under the PostgREST row cap (752 now, cap 3000). Once Bajaj's re-import pushes past the cap, the DB — ordered `category, created_at` — decides which rows arrive, so a client regroup can't guarantee in-stock items survive. The **DB-side stock-ordering + server-side search + virtualization** belongs to the **queued Bajaj perf pass**, NOT here. Don't build it now.
- Keep brands A→Z (already); do not relabel in-stock headers.
- Read the newest `comments.md` review blocks first. Commit message must be literally accurate — the REVIEWER verifies by execution.
