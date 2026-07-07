"use client";

import { useMemo, useState, useTransition } from "react";
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
  // review flag ㉜🅑: which row is mid-write, so the toggle it lives on stays
  // busy through the refresh rather than dimming the whole table.
  const [busyId, setBusyId] = useState<string | null>(null);
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

  function closeAndRefresh() {
    setModal(null);
    router.refresh();
  }

  async function toggleActive(p: ProductRow) {
    setBusyId(p.id);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id);
    if (updateError) {
      setBusyId(null);
      setError(updateError.message);
      return;
    }
    // Stay busy through the refresh (㉜🅑) — clear busy only after the fresh
    // data is queued to repaint, matching RetailersQueue.setActive.
    startTransition(() => {
      router.refresh();
      setBusyId(null);
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
              {products.map((p, index) => (
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
                      disabled={busyId === p.id}
                    >
                      {p.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.cards}>
            {products.map((p) => (
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
                <div className={styles.cardMeta}>
                  {p.brands?.name ?? "—"} · {p.category} · {p.tally_name}
                </div>
                <button
                  type="button"
                  className={`${styles.toggle} ${p.active ? styles.toggleOn : styles.toggleOff}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleActive(p);
                  }}
                  disabled={busyId === p.id}
                >
                  {p.active ? "Active" : "Inactive"}
                </button>
              </div>
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
