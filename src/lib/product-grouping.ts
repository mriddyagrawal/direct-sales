// Shared stock-first product grouping — one copy of the sort rules for both
// Quick Order (new-order) and the read-only salesman Products page. Extracted
// from QuickOrder (b5e446f) as a PURE move: the output is byte-identical.
//
// Within each brand, categories split by stock so a category can render up to
// TWICE — its in-stock items (plain header) then its out-of-stock/never-synced
// items ("(out of stock)" header). All in-stock categories precede all
// out-of-stock ones. Everything A→Z: brands, categories within each block, and
// products by name.
//
// Scale note: a pure client regroup, correct only while the catalog fits under
// the PostgREST row cap (752 now, cap 3000). Past the cap the DB — ordered
// category, created_at — decides which rows arrive, so a client regroup can't
// guarantee in-stock rows survive; DB-side stock ordering + server search +
// virtualization is the queued Bajaj perf pass, NOT this.

export interface StockGroupable {
  category: string;
  name: string;
  brand_id: string;
  brand_name: string;
  stock_qty: number | null;
}

export interface StockCategoryGroup<T> {
  category: string;
  outOfStock: boolean;
  products: T[];
}

export interface StockBrandGroup<T> {
  brandId: string;
  brandName: string;
  categories: StockCategoryGroup<T>[];
}

export function groupProductsStockFirst<T extends StockGroupable>(visible: T[]): StockBrandGroup<T>[] {
  function toCategoryGroups(list: T[], outOfStock: boolean): StockCategoryGroup<T>[] {
    const byCat = new Map<string, T[]>();
    for (const p of list) {
      const arr = byCat.get(p.category) ?? [];
      if (arr.length === 0) byCat.set(p.category, arr);
      arr.push(p);
    }
    return [...byCat.entries()]
      .map(([category, ps]) => ({
        category,
        outOfStock,
        products: [...ps].sort((a, b) => a.name.localeCompare(b.name)), // items A→Z
      }))
      .sort((a, b) => a.category.localeCompare(b.category)); // categories A→Z
  }
  const byBrand = new Map<string, { brandName: string; products: T[] }>();
  for (const p of visible) {
    let bg = byBrand.get(p.brand_id);
    if (!bg) {
      bg = { brandName: p.brand_name, products: [] };
      byBrand.set(p.brand_id, bg);
    }
    bg.products.push(p);
  }
  return [...byBrand.entries()]
    .map(([brandId, bg]) => {
      const inStock = bg.products.filter((p) => (p.stock_qty ?? 0) > 0);
      const outStock = bg.products.filter((p) => (p.stock_qty ?? 0) <= 0); // 0 AND null → out
      return {
        brandId,
        brandName: bg.brandName,
        categories: [...toCategoryGroups(inStock, false), ...toCategoryGroups(outStock, true)],
      };
    })
    .sort((a, b) => a.brandName.localeCompare(b.brandName)); // brands A→Z
}

// Total products in a brand group (sum across its category blocks) — the muted
// count shown in the brand header on both surfaces.
export function brandGroupCount<T>(bg: StockBrandGroup<T>): number {
  return bg.categories.reduce((n, c) => n + c.products.length, 0);
}
