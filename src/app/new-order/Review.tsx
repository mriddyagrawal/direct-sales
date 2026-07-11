"use client";

import { useMemo, useState } from "react";
import { Home, Plus } from "lucide-react";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Stepper } from "@/components/ui/Stepper";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { formatRupees } from "@/lib/format";
import { parsePricePaise } from "@/lib/price";
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
  onChangePrice?: (productId: string, pricePaise: number) => void;
  onNotesChange: (notes: string) => void;
  onChangeRetailer: () => void;
  onAddItem: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}

// S5 — the review/cart screen: editable line list (qty always; unit price for
// manual/LG lines), add-more, notes, computed total, submit. Any failure
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
  onChangePrice,
  onNotesChange,
  onChangeRetailer,
  onAddItem,
  onBack,
  onSubmit,
  submitting,
  submitError,
}: ReviewProps) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // Effective unit price: catalog for fixed brands, the salesman's entered
  // price for manual (LG) lines.
  const pricesById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) if (p.price_paise != null) map[p.id] = p.price_paise;
    return { ...map, ...snapshotPrices, ...prices };
  }, [products, snapshotPrices, prices]);

  // Draft strings for the editable manual-price inputs (seeded from the
  // committed paise value; the committed value lives in the parent cart).
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  function handlePrice(id: string, raw: string) {
    setPriceDraft((prev) => ({ ...prev, [id]: raw }));
    const parsed = parsePricePaise(raw);
    onChangePrice?.(id, parsed.ok && parsed.paise != null ? parsed.paise : 0);
  }

  // ㉕ — a line whose product left the catalog mid-window (edit mode only)
  // still has to appear here: it's still in `items`, still counted in `total`,
  // still sent to update_order_items. Fall back to the snapshot name.
  const lines = Object.entries(items)
    .map(([productId, qty]) => {
      const product = byId.get(productId);
      const name = product?.name ?? snapshotNames?.[productId];
      if (!name) return null;
      return { productId, qty, name, product };
    })
    .filter((l): l is { productId: string; qty: number; name: string; product: ProductOption | undefined } => l !== null);

  const total = cartTotalPaise(items, pricesById);

  return (
    <div className={styles.page}>
      <FlowHeader title="Review order" onBack={onBack} />
      <div className={styles.content}>
        <div className={styles.retailerHeader}>
          <span className={styles.retailerIcon} aria-hidden>
            <Glyph icon={Home} size={16} />
          </span>
          <div className={styles.retailerText}>
            <p className={styles.retailerName}>{retailerName}</p>
            {retailerArea && <p className={styles.retailerArea}>{retailerArea}</p>}
          </div>
          {!isEdit && (
            <button type="button" className={styles.changeLink} onClick={onChangeRetailer}>
              Change
            </button>
          )}
        </div>

        <div className={styles.card}>
          {lines.map(({ productId, qty, name, product }) => {
            const rate = pricesById[productId] ?? 0;
            const orderable = !!product;
            const manual = product?.pricing_mode === "manual";
            const model = product?.show_model && product.tally_name && product.tally_name !== name ? product.tally_name : null;
            const priceValue = priceDraft[productId] ?? (rate ? String(Math.round(rate) / 100) : "");
            return (
              <div key={productId} className={styles.line}>
                {/* Full-height red rail on the far LEFT (owner spec); inverts to
                    solid red on press. Removes the line (qty → 0). */}
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => onChangeQty(productId, 0)}
                  aria-label={`Remove ${name}`}
                >
                  ✕
                </button>
                <div className={styles.lineInfo}>
                  {model && <span className={styles.lineModel}>{model}</span>}
                  <p className={styles.lineName}>{name}</p>
                  {manual && orderable ? (
                    <label className={styles.priceEdit}>
                      <span className={styles.pricePrefix}>₹</span>
                      <input
                        className={styles.priceInput}
                        inputMode="decimal"
                        value={priceValue}
                        placeholder="Unit price"
                        onChange={(e) => handlePrice(productId, e.target.value)}
                        aria-label={`Unit price for ${name}`}
                      />
                      <span className={styles.priceEach}>each</span>
                    </label>
                  ) : (
                    <p className={styles.lineRate}>
                      {formatRupees(rate)} each
                      {!orderable && " · no longer orderable"}
                    </p>
                  )}
                </div>

                <div className={styles.lineControls}>
                  {orderable && (
                    <Stepper
                      qty={qty}
                      max={UI_QTY_CAP}
                      size="sm"
                      onChange={(next) => onChangeQty(productId, next)}
                      onTapQuantity={() => {}}
                    />
                  )}
                  <span className={styles.lineAmount}>{formatRupees(rate * qty)}</span>
                </div>
              </div>
            );
          })}

          <button type="button" className={styles.addItem} onClick={onAddItem}>
            <Glyph icon={Plus} size={16} />
            Add item
          </button>
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
      </div>

      <div className={styles.footer}>
        {submitError && <p className={styles.errorStrip}>{submitError}</p>}
        <div className={styles.totalRow}>
          <span className={styles.totalLabel}>
            Total · {lines.length} {lines.length === 1 ? "item" : "items"}
          </span>
          <span className={styles.totalAmount}>{formatRupees(total)}</span>
        </div>
        <Button variant="primary" onClick={onSubmit} loading={submitting} disabled={lines.length === 0}>
          {isEdit ? "Save changes" : "Submit order"}
        </Button>
      </div>
    </div>
  );
}
