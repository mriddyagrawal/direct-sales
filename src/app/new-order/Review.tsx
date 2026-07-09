"use client";

import { useMemo } from "react";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Stepper } from "@/components/ui/Stepper";
import { Button } from "@/components/ui/Button";
import { formatRupees } from "@/lib/format";
import { cartTotalPaise } from "@/lib/cart";
import type { ProductOption } from "./page";
import styles from "./Review.module.css";

const NOTES_MAX = 500;
const UI_QTY_CAP = 999;

interface ReviewProps {
  products: ProductOption[];
  prices?: Record<string, number>; // entered unit prices (manual/LG lines)
  snapshotPrices?: Record<string, number>;
  snapshotNames?: Record<string, string>;
  items: Record<string, number>;
  notes: string;
  retailerName: string;
  retailerArea: string | null;
  isEdit: boolean;
  onChangeQty: (productId: string, qty: number) => void;
  onNotesChange: (notes: string) => void;
  onChangeRetailer: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}

// S5 — editable line list, notes, computed total, submit. Any failure
// (offline included — the queue is gone, owner decision 2026-07-10) shows in
// the error strip and the salesman simply retries; the idempotent orderId
// means a retry never creates a duplicate.
export function Review({
  products,
  prices,
  snapshotPrices,
  snapshotNames,
  items,
  notes,
  retailerName,
  retailerArea,
  isEdit,
  onChangeQty,
  onNotesChange,
  onChangeRetailer,
  onBack,
  onSubmit,
  submitting,
  submitError,
}: ReviewProps) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // Effective unit price: catalog for fixed brands, the salesman's entered
  // price for manual (LG) lines. Manual products have no catalog price, so
  // they only appear here once priced.
  const pricesById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) if (p.price_paise != null) map[p.id] = p.price_paise;
    return { ...map, ...snapshotPrices, ...prices };
  }, [products, snapshotPrices, prices]);

  // ㉕ — a line whose product left the catalog mid-window (edit mode only)
  // still has to appear here: it's still in `items`, still counted in
  // `total` below, and still gets sent to update_order_items. Fall back to
  // the order's own snapshot name rather than dropping the line silently.
  const lines = Object.entries(items)
    .map(([productId, qty]) => {
      const product = byId.get(productId);
      const name = product?.name ?? snapshotNames?.[productId];
      if (!name) return null;
      return { productId, qty, name, orderable: !!product };
    })
    .filter((l): l is { productId: string; qty: number; name: string; orderable: boolean } => l !== null);

  const total = cartTotalPaise(items, pricesById);

  return (
    <div className={styles.page}>
      <FlowHeader title="Review order" onBack={onBack} />
      <div className={styles.content}>
        <div className={styles.retailerHeader}>
          <div>
            <p className={styles.retailerName}>{retailerName}</p>
            {retailerArea && <p className={styles.retailerArea}>{retailerArea}</p>}
          </div>
          {!isEdit && (
            <button type="button" className={styles.changeLink} onClick={onChangeRetailer}>
              Change
            </button>
          )}
        </div>

        <div>
          {lines.map(({ productId, qty, name, orderable }) => {
            const rate = pricesById[productId] ?? 0;
            return (
              <div key={productId} className={styles.line}>
                <div className={styles.lineInfo}>
                  <p className={styles.lineName}>{name}</p>
                  <p className={styles.lineRate}>
                    @ {formatRupees(rate)}
                    {!orderable && " · no longer orderable"}
                  </p>
                </div>
                <div className={styles.lineActions}>
                  {orderable && (
                    <Stepper qty={qty} max={UI_QTY_CAP} onChange={(next) => onChangeQty(productId, next)} onTapQuantity={() => {}} />
                  )}
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => onChangeQty(productId, 0)}
                    aria-label={`Remove ${name}`}
                  >
                    {orderable ? "✕" : "Remove"}
                  </button>
                </div>
                <span className={styles.lineAmount}>{formatRupees(rate * qty)}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.notesField}>
          <span className={styles.notesLabel}>
            <span>NOTES FOR THE OFFICE</span>
            <span>
              {notes.length}/{NOTES_MAX}
            </span>
          </span>
          <textarea
            className={styles.notesInput}
            value={notes}
            maxLength={NOTES_MAX}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="e.g. deliver Tuesday, urgent"
          />
        </div>

        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>Total · {lines.length} items</span>
          <span className={styles.totalAmount}>{formatRupees(total)}</span>
        </div>

        {submitError && <p className={styles.errorStrip}>{submitError}</p>}

        <Button variant="primary" onClick={onSubmit} loading={submitting} disabled={lines.length === 0}>
          {isEdit ? "Save changes" : "Submit order"}
        </Button>
      </div>
    </div>
  );
}
