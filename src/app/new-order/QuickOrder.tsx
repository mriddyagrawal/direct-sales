"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Stepper } from "@/components/ui/Stepper";
import { KeypadSheet } from "@/components/ui/KeypadSheet";
import { formatRupees } from "@/lib/format";
import { cartLineCount, cartTotalPaise } from "@/lib/cart";
import type { ProductOption } from "./page";
import styles from "./QuickOrder.module.css";

const UI_QTY_CAP = 999; // deliberately stricter than the DB's 1..9999 — fail-safe, don't "fix" it.

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

interface CategoryGroup {
  category: string;
  products: ProductOption[];
}
interface BrandGroup {
  brandId: string;
  brandName: string;
  categories: CategoryGroup[];
}

interface QuickOrderProps {
  products: ProductOption[];
  retailerName: string;
  retailerArea: string | null;
  items: Record<string, number>;
  snapshotPrices?: Record<string, number>;
  snapshotNames?: Record<string, string>;
  onChangeQty: (productId: string, qty: number) => void;
  onReview: () => void;
  onBack: () => void;
}

// S4 — the hero screen. Category-grouped dense list, sticky client-side
// search (no network round-trip), stepper + keypad, sticky split cart bar.
//
// Phase 3a: brand is a first-class order attribute. When ≥2 brands are
// orderable, a plain <select> beside the search filters by brand, and "All
// brands" nests Brand ▸ Category with two-tier sticky headers. Adding the
// first item lazily auto-locks the brand (one order = one brand — the server
// guard is the real wall, this is just the pleasant front-end). With a single
// brand (today's Zebronics), none of this shows — the screen is unchanged.
export function QuickOrder({
  products,
  retailerName,
  retailerArea,
  items,
  snapshotPrices,
  snapshotNames,
  onChangeQty,
  onReview,
  onBack,
}: QuickOrderProps) {
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all"); // "all" | brand_id
  const [keypadProductId, setKeypadProductId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);

  // Keep --search-bar-height equal to the search bar's real rendered
  // height so the sticky headers pin flush beneath it. The bar grows/shrinks
  // (the "N of M products" line only shows while searching, the brand-lock
  // cue only while locked); a ResizeObserver writes the live height to the
  // page's CSS var (a plain DOM mutation — no React state), so the offset is
  // always exact without reserving a blank line.
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

  // Snapshot prices (existing lines, if editing) win over the live catalog
  // price — a catalog re-price never rewrites what a survivor line shows.
  const pricesById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) map[p.id] = p.price_paise;
    return { ...map, ...snapshotPrices };
  }, [products, snapshotPrices]);

  // Orderable brands = the distinct brands present in the (already active +
  // priced, RLS-scoped) catalog. One brand ⇒ no brand UI at all.
  const brandOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) if (!byId.has(p.brand_id)) byId.set(p.brand_id, p.brand_name);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  const multiBrand = brandOptions.length >= 2;

  // Lazy auto-lock: the cart's brand (all cart lines share one brand while
  // locked). Non-empty cart ⇒ locked to that brand; empty ⇒ unlocked.
  const cartBrandId = useMemo(() => {
    const first = products.find((p) => (items[p.id] ?? 0) > 0);
    return first?.brand_id ?? null;
  }, [products, items]);
  const locked = cartBrandId !== null;

  // The brand actually in effect: locked ⇒ the cart's brand; else the picked
  // filter (null = "All brands"). null + multiBrand ⇒ the two-tier view.
  const effectiveBrand = locked ? cartBrandId : brandFilter === "all" ? null : brandFilter;
  const lockedBrandName = locked ? (brandOptions.find((b) => b.id === cartBrandId)?.name ?? "") : "";

  const q = normalize(query.trim());
  const visible = products.filter(
    (p) => (q === "" || normalize(p.name).includes(q)) && (effectiveBrand === null || p.brand_id === effectiveBrand),
  );

  // Nested Brand ▸ Category, preserving encounter order for categories and
  // alphabetical order for brands.
  const brandGroups: BrandGroup[] = useMemo(() => {
    const byBrand = new Map<string, { brandName: string; cats: Map<string, ProductOption[]> }>();
    for (const p of visible) {
      let bg = byBrand.get(p.brand_id);
      if (!bg) {
        bg = { brandName: p.brand_name, cats: new Map() };
        byBrand.set(p.brand_id, bg);
      }
      const cat = bg.cats.get(p.category) ?? [];
      if (cat.length === 0) bg.cats.set(p.category, cat);
      cat.push(p);
    }
    return [...byBrand.entries()]
      .map(([brandId, bg]) => ({
        brandId,
        brandName: bg.brandName,
        categories: [...bg.cats.entries()].map(([category, ps]) => ({ category, products: ps })),
      }))
      .sort((a, b) => a.brandName.localeCompare(b.brandName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, items, brandFilter, query]);

  const showBrandTier = effectiveBrand === null && multiBrand;
  const allCategories = brandGroups.flatMap((bg) => bg.categories);

  const itemCount = cartLineCount(items);
  const totalPaise = cartTotalPaise(items, pricesById);
  const keypadProduct = products.find((p) => p.id === keypadProductId) ?? null;

  // ㉕ — a line whose product has left the active+priced catalog mid-window
  // (edit mode only) must still be visible so it can be removed, rather than
  // silently vanishing while still counted in the total and sent.
  const catalogIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const unavailable = Object.keys(items)
    .filter((id) => !catalogIds.has(id) && snapshotNames?.[id])
    .map((id) => ({ id, name: snapshotNames![id], qty: items[id], price: pricesById[id] ?? 0 }));

  function renderCategory(group: CategoryGroup) {
    return (
      <section key={group.category}>
        <div className={styles.categoryHeader}>
          <span>{group.category}</span>
          <span>{group.products.length}</span>
        </div>
        {group.products.map((p) => {
          const qty = items[p.id] ?? 0;
          const inCart = qty > 0;
          return (
            <div key={p.id} className={`${styles.productRow} ${inCart ? styles.productRowActive : ""}`}>
              <div className={styles.productInfo}>
                <p className={`${styles.productName} ${inCart ? styles.productNameActive : ""}`}>{p.name}</p>
                <p className={styles.productPrice}>{formatRupees(pricesById[p.id] ?? p.price_paise)}</p>
              </div>
              <Stepper
                qty={qty}
                max={UI_QTY_CAP}
                onChange={(next) => onChangeQty(p.id, next)}
                onTapQuantity={() => setKeypadProductId(p.id)}
              />
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <div className={styles.page} ref={pageRef}>
      <FlowHeader title={retailerName} subtitle={retailerArea ?? undefined} onBack={onBack} />
      <div className={styles.searchBar} ref={searchBarRef}>
        <div className={styles.searchRow}>
          {multiBrand && (
            <select
              className={styles.brandSelect}
              value={locked ? (cartBrandId ?? "all") : brandFilter}
              disabled={locked}
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
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name"
          />
        </div>
        {q !== "" && (
          <span className={styles.resultMeta}>
            {visible.length} of {products.length} products
          </span>
        )}
        {multiBrand && locked && (
          <span className={styles.lockNote}>Showing {lockedBrandName} — clear the cart to switch brands</span>
        )}
      </div>

      <div className={`${styles.list} ${showBrandTier ? styles.listTwoTier : ""}`}>
        {unavailable.length > 0 && (
          <section>
            <div className={styles.categoryHeader}>
              <span>NO LONGER AVAILABLE</span>
              <span>{unavailable.length}</span>
            </div>
            {unavailable.map((line) => (
              <div key={line.id} className={styles.productRow}>
                <div className={styles.productInfo}>
                  <p className={styles.productName}>{line.name}</p>
                  <p className={styles.productPrice}>
                    {line.qty} × {formatRupees(line.price)} · no longer orderable
                  </p>
                </div>
                <button type="button" className={styles.removeGhost} onClick={() => onChangeQty(line.id, 0)}>
                  Remove
                </button>
              </div>
            ))}
          </section>
        )}
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
              <div className={styles.brandHeader}>{bg.brandName}</div>
              {bg.categories.map((c) => renderCategory(c))}
            </section>
          ))
        ) : (
          allCategories.map((c) => renderCategory(c))
        )}
      </div>

      {itemCount > 0 && (
        <div className={styles.cartBar}>
          <div className={styles.cartData}>
            <span className={styles.cartItems}>
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
            <span className={styles.cartTotal}>{formatRupees(totalPaise)}</span>
          </div>
          <button type="button" className={styles.cartAction} onClick={onReview}>
            Review ›
          </button>
        </div>
      )}

      {keypadProduct && (
        <KeypadSheet
          productName={keypadProduct.name}
          currentQty={items[keypadProduct.id] ?? 0}
          max={UI_QTY_CAP}
          onCancel={() => setKeypadProductId(null)}
          onSet={(qty) => {
            onChangeQty(keypadProduct.id, qty);
            setKeypadProductId(null);
          }}
        />
      )}
    </div>
  );
}
