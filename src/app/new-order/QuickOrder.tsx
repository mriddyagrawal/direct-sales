"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Stepper } from "@/components/ui/Stepper";
import { KeypadSheet } from "@/components/ui/KeypadSheet";
import { formatRupees } from "@/lib/format";
import { cartLineCount, cartTotalPaise } from "@/lib/cart";
import { parsePricePaise } from "@/lib/price";
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
  prices?: Record<string, number>; // entered unit prices (paise) for manual/LG lines
  snapshotPrices?: Record<string, number>;
  snapshotNames?: Record<string, string>;
  onChangeQty: (productId: string, qty: number) => void;
  onChangePrice?: (productId: string, pricePaise: number) => void;
  onReview: () => void;
  onBack: () => void;
}

// S4 — the hero screen. Brand▸Category grouped dense list, sticky client-side
// search, sticky split cart bar.
//
// Phase 3a: brand dropdown + two-tier grouping + lazy brand-lock.
// Phase 3b: rows collapse to name + price; tapping a row reveals its qty
// stepper (and, for manual-pricing brands like LG, a unit-price input) inside
// the drop. Multiple rows open independently; in-cart rows start expanded.
export function QuickOrder({
  products,
  retailerName,
  retailerArea,
  items,
  prices,
  snapshotPrices,
  snapshotNames,
  onChangeQty,
  onChangePrice,
  onReview,
  onBack,
}: QuickOrderProps) {
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all"); // "all" | brand_id
  const [keypadProductId, setKeypadProductId] = useState<string | null>(null);
  // Per-row collapse state (a Set, NOT an accordion — several rows open at
  // once). Seeded ONCE from in-cart lines so drafts/in-cart lines show their
  // controls without a tap.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(Object.keys(items).filter((id) => (items[id] ?? 0) > 0)),
  );
  // Local text buffer for manual price inputs (keeps "45." mid-type); the
  // committed paise value lives in the parent cart via onChangePrice.
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const pageRef = useRef<HTMLDivElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);

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

  // Effective unit price: catalog for fixed brands (snapshot wins if editing),
  // entered price for manual (LG) lines. Manual products have no catalog price.
  const pricesById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) if (p.price_paise != null) map[p.id] = p.price_paise;
    return { ...map, ...snapshotPrices, ...prices };
  }, [products, snapshotPrices, prices]);

  const brandOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) if (!byId.has(p.brand_id)) byId.set(p.brand_id, p.brand_name);
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  const multiBrand = brandOptions.length >= 2;

  const cartBrandId = useMemo(() => {
    const first = products.find((p) => (items[p.id] ?? 0) > 0);
    return first?.brand_id ?? null;
  }, [products, items]);
  const locked = cartBrandId !== null;

  const effectiveBrand = locked ? cartBrandId : brandFilter === "all" ? null : brandFilter;
  const lockedBrandName = locked ? (brandOptions.find((b) => b.id === cartBrandId)?.name ?? "") : "";

  // Search matches product name, category, OR brand — so "ze" surfaces all
  // Zebronics items and a category term (e.g. "adaptor", "refriger") surfaces
  // that whole category. Brand filtering (lock / picked) still applies on top.
  const q = normalize(query.trim());
  const matchesSearch = (p: ProductOption) =>
    q === "" ||
    normalize(p.name).includes(q) ||
    normalize(p.category).includes(q) ||
    normalize(p.brand_name).includes(q);
  const visible = products.filter((p) => matchesSearch(p) && (effectiveBrand === null || p.brand_id === effectiveBrand));

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

  const catalogIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const unavailable = Object.keys(items)
    .filter((id) => !catalogIds.has(id) && snapshotNames?.[id])
    .map((id) => ({ id, name: snapshotNames![id], qty: items[id], price: pricesById[id] ?? 0 }));

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handlePriceInput(id: string, text: string) {
    setPriceText((prev) => ({ ...prev, [id]: text }));
    const parsed = parsePricePaise(text);
    onChangePrice?.(id, parsed.ok && parsed.paise != null ? parsed.paise : 0);
  }

  function renderProduct(p: ProductOption) {
    const qty = items[p.id] ?? 0;
    const inCart = qty > 0;
    const isManual = p.pricing_mode === "manual";
    const expanded = expandedIds.has(p.id);
    const entered = prices?.[p.id] ?? snapshotPrices?.[p.id];
    const priceLabel = isManual
      ? entered != null
        ? formatRupees(entered)
        : "Tap to price"
      : formatRupees(pricesById[p.id] ?? p.price_paise ?? 0);
    const buffered = priceText[p.id];
    const inputVal = buffered ?? (entered != null ? String(entered / 100) : "");
    const parsed = isManual && buffered != null && buffered !== "" ? parsePricePaise(buffered) : null;
    const priceError = parsed && !parsed.ok ? parsed.error : null;

    return (
      <div key={p.id} className={`${styles.collapseRow} ${inCart ? styles.collapseRowActive : ""}`}>
        <button
          type="button"
          className={styles.productHead}
          onClick={() => toggleExpanded(p.id)}
          aria-expanded={expanded}
        >
          <span className={styles.productHeadInfo}>
            <span className={`${styles.productName} ${inCart ? styles.productNameActive : ""}`}>{p.name}</span>
            <span className={`${styles.productPrice} ${isManual && entered == null ? styles.productPricePrompt : ""}`}>
              {priceLabel}
              {inCart ? ` · ${qty} in cart` : ""}
            </span>
          </span>
          <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} aria-hidden />
        </button>

        {expanded && (
          <div className={styles.productDrop}>
            {isManual && (
              <label className={styles.priceField}>
                <span className={styles.pricePrefix}>₹</span>
                <input
                  className={styles.priceInput}
                  inputMode="decimal"
                  value={inputVal}
                  placeholder="Unit price"
                  onChange={(e) => handlePriceInput(p.id, e.target.value)}
                />
              </label>
            )}
            <Stepper
              qty={qty}
              max={UI_QTY_CAP}
              onChange={(next) => onChangeQty(p.id, next)}
              onTapQuantity={() => setKeypadProductId(p.id)}
            />
            {priceError && <span className={styles.priceError}>{priceError}</span>}
          </div>
        )}
      </div>
    );
  }

  function renderCategory(group: CategoryGroup) {
    return (
      <section key={group.category}>
        <div className={styles.categoryHeader}>
          <span>{group.category}</span>
          <span>{group.products.length}</span>
        </div>
        {group.products.map(renderProduct)}
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
            placeholder="Search name, brand or category"
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
