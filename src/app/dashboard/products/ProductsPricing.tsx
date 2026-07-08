"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { formatRupees } from "@/lib/format";
import { ProductModal, type BrandOption } from "./ProductModal";
import { ImportWizard } from "./ImportWizard";
import type { ProductRow } from "./page";
import styles from "./ProductsPricing.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; product: ProductRow } | null;

// M5.5 commit 2 — Products catalog ledger (S8 grammar: hairlines, mono
// figures, muted metadata, bold display name). Replaces the grouped
// price-edit card list.
//
// review flag ㉜🅐: renders straight from the `initialProducts` prop, never
// copied into useState — a post-write router.refresh() then delivers fresh
// server data the table actually shows (a plain useState would read its
// initializer once and ignore the refresh, leaving a stale row).
//
// Editable surfaces: the inline ACTIVE toggle, plus the shared Add/Edit modal
// — "+ Add product" (admin-only) and row-click to edit any row (accountant
// edits price/tally/active; admin edits all fields).
export function ProductsPricing({
  initialProducts: products,
  brands,
  isAdmin,
}: {
  initialProducts: ProductRow[];
  brands: BrandOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  // Optimistic active overlay so a row's toggle flips instantly instead of
  // waiting on router.refresh(). useOptimistic auto-reconciles to the server
  // prop once it updates (post-refresh, or after a modal edit changes active),
  // so a stale flip can never mask real data — preserving render-from-prop
  // (㉜🅐). Render from `displayProducts` where active matters.
  const [displayProducts, applyOptimisticActive] = useOptimistic(
    products,
    (state: ProductRow[], patch: { id: string; active: boolean }) =>
      state.map((p) => (p.id === patch.id ? { ...p, active: patch.active } : p)),
  );
  // review flag ㉜🅑: which rows are mid-write (a Set — several toggles can be
  // in flight at once, unlike a single id which behaved like a radio button).
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [importing, setImporting] = useState(false);

  const priced = products.filter((p) => p.price_paise !== null).length;

  // Brand-scoped existing categories drive the modal's typeahead + the
  // "speakers"→"Speakers" normalization (derived from the full catalog).
  const categoriesByBrand = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of products) {
      const list = (map[p.brand_id] ??= []);
      if (!list.includes(p.category)) list.push(p.category);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.localeCompare(b));
    return map;
  }, [products]);

  // Mobile-only Brand ▸ Category grouping (desktop keeps the flat table).
  // Brands alphabetical; categories in encounter order (products arrive
  // ordered by category, then name).
  const mobileGroups = useMemo(() => {
    const byBrand = new Map<string, { brandName: string; cats: Map<string, ProductRow[]> }>();
    for (const p of displayProducts) {
      let bg = byBrand.get(p.brand_id);
      if (!bg) {
        bg = { brandName: p.brands?.name ?? "—", cats: new Map() };
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
  }, [displayProducts]);
  const multiBrandProducts = mobileGroups.length >= 2;

  function closeAndRefresh() {
    setModal(null);
    router.refresh();
  }

  function renderCard(p: ProductRow) {
    return (
      <div
        key={p.id}
        className={`${styles.card} ${styles.clickable} ${!p.active ? styles.cardInactive : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setModal({ mode: "edit", product: p })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setModal({ mode: "edit", product: p });
          }
        }}
      >
        <div className={styles.cardTop}>
          <span className={styles.cardName}>{p.name}</span>
          <span className={styles.mono}>
            {p.price_paise === null ? <span className={styles.tbd}>TBD</span> : formatRupees(p.price_paise)}
          </span>
        </div>
        {/* Brand + category now live in the sticky headers; show a Tally line
            only when it actually differs from the display name (it defaults to
            the name, so echoing it is noise). */}
        {p.tally_name !== p.name && <div className={styles.cardTally}>{p.tally_name}</div>}
        <button
          type="button"
          className={`${styles.toggle} ${p.active ? styles.toggleOn : styles.toggleOff}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleActive(p);
          }}
          disabled={busy.has(p.id)}
        >
          {p.active ? "Active" : "Inactive"}
        </button>
      </div>
    );
  }

  function toggleActive(p: ProductRow) {
    const next = !p.active; // p is from displayProducts, so this is the shown state
    setBusy((prev) => new Set(prev).add(p.id));
    setError(null);
    startTransition(async () => {
      applyOptimisticActive({ id: p.id, active: next }); // instant flip; auto-reverts if the write fails
      const supabase = createClient();
      const { error: updateError } = await supabase.from("products").update({ active: next }).eq("id", p.id);
      if (updateError) setError(updateError.message);
      else router.refresh(); // reconciles the overlay to fresh server data
      setBusy((prev) => {
        const s = new Set(prev);
        s.delete(p.id);
        return s;
      });
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Products</h1>
        <span className={styles.count}>
          {products.length} products · {priced} priced
        </span>
        {isAdmin && (
          <div className={styles.titleActions}>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button variant="primary" onClick={() => setModal({ mode: "add" })}>
              + Add product
            </Button>
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {products.length === 0 ? (
        <p className={styles.empty}>No products in the catalog.</p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.numeric}>#</th>
                <th>BRAND</th>
                <th>CATEGORY</th>
                <th>DISPLAY NAME</th>
                <th>TALLY NAME</th>
                <th className={styles.numeric}>PRICE</th>
                <th>ACTIVE</th>
              </tr>
            </thead>
            <tbody>
              {displayProducts.map((p, index) => (
                <tr
                  key={p.id}
                  className={`${styles.clickable} ${!p.active ? styles.rowInactive : ""}`}
                  onClick={() => setModal({ mode: "edit", product: p })}
                >
                  <td className={`${styles.mono} ${styles.numeric} ${styles.cellMeta}`}>{index + 1}</td>
                  <td className={styles.cellMeta}>{p.brands?.name ?? "—"}</td>
                  <td className={styles.cellMeta}>{p.category}</td>
                  <td className={styles.cellName}>{p.name}</td>
                  <td className={`${styles.mono} ${styles.cellMeta}`}>{p.tally_name}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>
                    {p.price_paise === null ? <span className={styles.tbd}>TBD</span> : formatRupees(p.price_paise)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`${styles.toggle} ${p.active ? styles.toggleOn : styles.toggleOff}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleActive(p);
                      }}
                      disabled={busy.has(p.id)}
                    >
                      {p.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={`${styles.cards} ${multiBrandProducts ? styles.cardsTwoTier : ""}`}>
            {mobileGroups.map((bg) => (
              <section key={bg.brandId}>
                {multiBrandProducts && <div className={styles.mBrandHeader}>{bg.brandName}</div>}
                {bg.categories.map((c) => (
                  <section key={c.category}>
                    <div className={styles.mCatHeader}>{c.category}</div>
                    {c.products.map(renderCard)}
                  </section>
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      {modal && (
        <ProductModal
          mode={modal.mode}
          isAdmin={isAdmin}
          brands={brands}
          categoriesByBrand={categoriesByBrand}
          initial={modal.mode === "edit" ? modal.product : undefined}
          onClose={() => setModal(null)}
          onSaved={closeAndRefresh}
        />
      )}

      {importing && (
        <ImportWizard
          brands={brands}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
