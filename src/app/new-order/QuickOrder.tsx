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
  const [keypadProductId, setKeypadProductId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);

  // test/salesman-ui-collapse — rows collapse to name + price by default;
  // tapping one reveals the stepper below it (same "appears on demand" shape
  // as the search bar's result-count line). Independent per row (not an
  // accordion) so a salesman can leave several open while dictating a list.
  // Seeded once from whatever already has a qty (e.g. reopening a draft) so
  // existing lines are visible without an extra tap; purely user-driven
  // after that.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(Object.keys(items).filter((id) => items[id] > 0)),
  );

  function toggleExpanded(productId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // Keep --search-bar-height equal to the search bar's real rendered
  // height so the sticky category headers pin flush beneath it. The bar
  // grows/shrinks when the "N of M products" line appears while searching;
  // a ResizeObserver writes the live height to the page's CSS var (a plain
  // DOM style mutation — no React state, no re-render), so the offset is
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

  const q = normalize(query.trim());
  const filtered = q === "" ? products : products.filter((p) => normalize(p.name).includes(q) || normalize(p.sku).includes(q));

  const groups: { category: string; products: ProductOption[] }[] = [];
  for (const p of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.category === p.category) last.products.push(p);
    else groups.push({ category: p.category, products: [p] });
  }

  const itemCount = cartLineCount(items);
  const totalPaise = cartTotalPaise(items, pricesById);
  const keypadProduct = products.find((p) => p.id === keypadProductId) ?? null;

  // ㉕ — a line whose product has left the active+priced catalog mid-window
  // (edit mode only; a create-mode draft has no snapshot to fall back on
  // and is pruned by NewOrderFlow instead) must still be visible — it's
  // still in `items` and still counted in the total — so it can be seen
  // and removed, rather than silently vanishing while still being sent.
  const catalogIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);
  const unavailable = Object.keys(items)
    .filter((id) => !catalogIds.has(id) && snapshotNames?.[id])
    .map((id) => ({ id, name: snapshotNames![id], qty: items[id], price: pricesById[id] ?? 0 }));

  return (
    <div className={styles.page} ref={pageRef}>
      <FlowHeader title={retailerName} subtitle={retailerArea ?? undefined} onBack={onBack} />
      <div className={styles.searchBar} ref={searchBarRef}>
        <input
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or SKU"
        />
        {q !== "" && (
          <span className={styles.resultMeta}>
            {filtered.length} of {products.length} products
          </span>
        )}
      </div>

      <div className={styles.list}>
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
        {groups.length === 0 ? (
          <div className={styles.empty}>
            <p>No products match &quot;{query}&quot;.</p>
            <p>Check the spelling, or try part of the SKU.</p>
            <button type="button" onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.category}>
              <div className={styles.categoryHeader}>
                <span>{group.category}</span>
                <span>{group.products.length}</span>
              </div>
              {group.products.map((p) => {
                const qty = items[p.id] ?? 0;
                const inCart = qty > 0;
                const expanded = expandedIds.has(p.id);
                return (
                  <div key={p.id} className={`${styles.productRow} ${inCart ? styles.productRowActive : ""}`}>
                    <button type="button" className={styles.productHead} onClick={() => toggleExpanded(p.id)}>
                      <div className={styles.productInfo}>
                        <p className={`${styles.productName} ${inCart ? styles.productNameActive : ""}`}>{p.name}</p>
                        <p className={styles.productPrice}>
                          {formatRupees(pricesById[p.id] ?? p.price_paise)}
                          {inCart && ` · ${qty} in cart`}
                        </p>
                      </div>
                      <span className={styles.expandHint} aria-hidden>
                        {expanded ? "︿" : "﹀"}
                      </span>
                    </button>
                    {expanded && (
                      <div className={styles.stepperRow}>
                        <Stepper
                          qty={qty}
                          max={UI_QTY_CAP}
                          onChange={(next) => onChangeQty(p.id, next)}
                          onTapQuantity={() => setKeypadProductId(p.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))
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
