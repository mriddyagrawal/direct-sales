"use client";

import { useMemo, useState } from "react";
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
  onChangeQty,
  onReview,
  onBack,
}: QuickOrderProps) {
  const [query, setQuery] = useState("");
  const [keypadProductId, setKeypadProductId] = useState<string | null>(null);

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

  return (
    <div className={styles.page}>
      <FlowHeader
        title={retailerName}
        subtitle={`${retailerArea ? retailerArea.toUpperCase() + " · " : ""}NEW ORDER`}
        onBack={onBack}
      />
      <div className={styles.searchBar}>
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
