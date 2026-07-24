"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { formatRupees, formatShortDate } from "@/lib/format";
import {
  groupProductsStockFirst,
  brandGroupCount,
  type StockCategoryGroup,
} from "@/lib/product-grouping";
import { createClient } from "@/lib/supabase/client";
import { fetchBrowseProducts, type BrowseProductRow as ProductRow } from "@/lib/queries/products";
import { useQuery } from "@tanstack/react-query";
import styles from "./ProductsBrowse.module.css";

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

// Read-only Products browser (owner 2026-07-23): search + brand dropdown +
// Brand▸Category stock-first grouping (the shared groupProductsStockFirst util,
// same sort as Quick Order), two-line rows (name · price left / stock right).
// Never mutates — no cart, stepper, keypad, or price inputs.
//
// Scale note: client-side browse over the loaded catalog, correct only under
// the PostgREST row cap (752 now, cap 3000); the DB-side search/virtualization
// for this page + Quick Order + staff products converges in the Bajaj perf
// pass — not here.
export function ProductsBrowse() {
  // Spec D10/D13: render ONLY from the query cache — seeded by the server
  // render (HydrationBoundary), corrected on mount/focus/reconnect (D6);
  // `?? []` keeps a painted list painted if a background refetch fails.
  const { data: products = [] } = useQuery({
    queryKey: ["products", "browse"],
    queryFn: () => fetchBrowseProducts(createClient()),
  });
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all"); // "all" | brand_id
  const pageRef = useRef<HTMLDivElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);

  // Pin the sticky category headers exactly under the (variable-height) search
  // bar — same live measurement as Quick Order.
  useEffect(() => {
    const bar = searchBarRef.current;
    const page = pageRef.current;
    if (!bar || !page) return;
    const sync = () => page.style.setProperty("--search-bar-height", `${bar.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // Brand dropdown options = brands present in the loaded catalog (a zero-
  // product brand never appears), A→Z — same derivation as Quick Order.
  const brandOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) if (!byId.has(p.brand_id)) byId.set(p.brand_id, p.brand_name);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  const multiBrand = brandOptions.length >= 2;
  const effectiveBrand = brandFilter === "all" ? null : brandFilter;

  // "Stock as of <t>" — the most recent sync across the catalog (ISO strings
  // compare chronologically). Omitted when nothing's been synced.
  const stockAsOf = useMemo(() => {
    let max: string | null = null;
    for (const p of products) if (p.stock_updated_at && (max === null || p.stock_updated_at > max)) max = p.stock_updated_at;
    return max;
  }, [products]);

  // Search matches name / category / brand / Tally-model — same predicate as
  // Quick Order; then the brand scope on top.
  const q = normalize(query.trim());
  const matchesSearch = (p: ProductRow) =>
    q === "" ||
    normalize(p.name).includes(q) ||
    normalize(p.category).includes(q) ||
    normalize(p.brand_name).includes(q) ||
    normalize(p.tally_name).includes(q);
  const visible = useMemo(
    () => products.filter((p) => matchesSearch(p) && (effectiveBrand === null || p.brand_id === effectiveBrand)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, q, effectiveBrand],
  );

  const brandGroups = useMemo(() => groupProductsStockFirst(visible), [visible]);
  const showBrandTier = effectiveBrand === null && multiBrand;
  const allCategories = brandGroups.flatMap((bg) => bg.categories);

  function renderProduct(p: ProductRow) {
    const inStock = p.stock_qty != null && p.stock_qty > 0;
    return (
      <div key={p.id} className={styles.row}>
        {/* Line 1 — name in the Quick Order standard: model・display when the
            brand shows a distinct model, else the plain name. */}
        <p className={styles.rowName}>
          {p.show_model && p.tally_name && p.tally_name !== p.name ? (
            <>
              <span className={styles.modelPrefix}>{p.tally_name}</span>
              {"・"}
              {p.name}
            </>
          ) : (
            p.name
          )}
        </p>
        {/* Line 2 — price left, stock pill right (null price → em dash; null/0
            stock → red "out of stock", same rule as Quick Order). */}
        <div className={styles.rowLine2}>
          <span className={styles.price}>{p.price_paise != null ? formatRupees(p.price_paise) : "—"}</span>
          <span className={`${styles.stockPill} ${inStock ? styles.stockIn : styles.stockOut}`}>
            {inStock ? `${p.stock_qty} in stock` : "out of stock"}
          </span>
        </div>
      </div>
    );
  }

  function renderCategory(group: StockCategoryGroup<ProductRow>) {
    return (
      <section key={`${group.category}__${group.outOfStock ? "out" : "in"}`}>
        <div className={styles.categoryHeader}>
          <span>{group.outOfStock ? `${group.category} (out of stock)` : group.category}</span>
          <span>{group.products.length}</span>
        </div>
        {group.products.map(renderProduct)}
      </section>
    );
  }

  return (
    <div className={styles.wrap} ref={pageRef}>
      <div className={styles.searchBar} ref={searchBarRef}>
        <div className={styles.searchRow}>
          {multiBrand && (
            <select
              className={styles.brandSelect}
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              aria-label="Brand"
            >
              <option value="all">All brands</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <div className={styles.searchBox}>
            <Glyph icon={Search} size={14} />
            <input
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, brand or category"
            />
          </div>
        </div>
        {stockAsOf && <span className={styles.asOf}>Stock as of {formatShortDate(stockAsOf)}</span>}
        {q !== "" && (
          <span className={styles.resultMeta}>
            {visible.length} of {products.length} products
          </span>
        )}
      </div>

      <div className={`${styles.list} ${showBrandTier ? styles.listTwoTier : ""}`}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <p>No products match &quot;{query}&quot;.</p>
            <p>Check the spelling, or try a shorter word.</p>
            <button type="button" onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
        ) : showBrandTier ? (
          brandGroups.map((bg) => (
            <section key={bg.brandId}>
              <div className={styles.brandHeader}>
                <span>{bg.brandName}</span>
                <span className={styles.brandCount}>{brandGroupCount(bg)} products</span>
              </div>
              {bg.categories.map((c) => renderCategory(c))}
            </section>
          ))
        ) : (
          allCategories.map((c) => renderCategory(c))
        )}
      </div>
    </div>
  );
}
