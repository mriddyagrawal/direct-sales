"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatRupees } from "@/lib/format";
import type { ProductRow } from "./page";
import styles from "./ProductsPricing.module.css";

// M5.5 commit 2 — Products catalog ledger (S8 grammar: hairlines, mono
// figures, muted metadata, bold display name). Replaces the grouped
// price-edit card list.
//
// review flag ㉜🅐: renders straight from the `initialProducts` prop, never
// copied into useState — a post-write router.refresh() then delivers fresh
// server data the table actually shows (a plain useState would read its
// initializer once and ignore the refresh, leaving a stale row).
//
// The only editable surface here is the inline ACTIVE toggle. Price / tally /
// name editing and "+ Add product" arrive in commit 3 as the row-click
// Add/Edit modal (per the M5.5 prompt) — until then this screen is a
// read-only ledger plus that toggle.
export function ProductsPricing({ initialProducts: products }: { initialProducts: ProductRow[] }) {
  const router = useRouter();
  // review flag ㉜🅑: which row is mid-write, so the toggle it lives on stays
  // busy through the refresh rather than dimming the whole table.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const priced = products.filter((p) => p.price_paise !== null).length;

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
                <tr key={p.id} className={!p.active ? styles.rowInactive : ""}>
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
                      onClick={() => toggleActive(p)}
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
              <div key={p.id} className={`${styles.card} ${!p.active ? styles.cardInactive : ""}`}>
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
                  onClick={() => toggleActive(p)}
                  disabled={busyId === p.id}
                >
                  {p.active ? "Active" : "Inactive"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
