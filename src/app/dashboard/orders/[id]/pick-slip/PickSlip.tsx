"use client";

import { useState } from "react";
import { formatFullTimestamp, formatRupees } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import styles from "./PickSlip.module.css";

interface PickSlipItem {
  product_name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
}

interface PickSlipProps {
  orderRef: string;
  submittedAt: string;
  notes: string;
  totalPaise: number;
  retailerName: string;
  retailerArea: string | null;
  retailerPhone: string | null;
  salesmanName: string;
  items: PickSlipItem[];
}

// S10 — the godown handoff. Print-CSS, no PDF library. Prices off by
// default (qty is what the godown reads); toggling them on relabels the
// sheet ORDER COPY so it can't be misfiled as a price list.
export function PickSlip({
  orderRef,
  submittedAt,
  notes,
  totalPaise,
  retailerName,
  retailerArea,
  retailerPhone,
  salesmanName,
  items,
}: PickSlipProps) {
  const [pricesOn, setPricesOn] = useState(false);
  const [printedAt] = useState(nowMs);

  return (
    <div className={styles.page}>
      <div className={styles.chrome}>
        <span className={styles.chromeTitle}>
          {orderRef} · PICK SLIP PREVIEW
        </span>
        <div className={styles.chromeControls}>
          <div className={styles.toggle}>
            <button
              type="button"
              className={`${styles.toggleButton} ${!pricesOn ? styles.toggleButtonActive : ""}`}
              onClick={() => setPricesOn(false)}
            >
              Prices off
            </button>
            <button
              type="button"
              className={`${styles.toggleButton} ${pricesOn ? styles.toggleButtonActive : ""}`}
              onClick={() => setPricesOn(true)}
            >
              Prices on
            </button>
          </div>
          <button type="button" className={styles.printButton} onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <div className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <div>
            <p className={styles.brand}>GANPATI ENTERPRISES</p>
            <p className={styles.ref}>{orderRef}</p>
          </div>
          <span className={styles.badge}>{pricesOn ? "ORDER COPY" : "PICK SLIP"}</span>
        </div>

        <div className={styles.metaGrid}>
          <span>
            Submitted: <span className={styles.metaMono}>{formatFullTimestamp(submittedAt)}</span>
          </span>
          <span>
            Retailer: {retailerName}
            {retailerArea ? `, ${retailerArea}` : ""}
            {retailerPhone ? (
              <>
                {"   Ph: "}
                <span className={styles.metaMono}>{retailerPhone}</span>
              </>
            ) : null}
          </span>
          <span>Salesman: {salesmanName}</span>
        </div>

        <p className={styles.linesRule}>{items.length} LINES</p>

        <table className={styles.itemsTable}>
          <thead>
            <tr>
              <th className={styles.qtyHeader}>QTY</th>
              <th>ITEM</th>
              {pricesOn && <th className={styles.numeric}>RATE</th>}
              {pricesOn && <th className={styles.numeric}>AMOUNT</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td className={styles.qtyCell}>{item.qty}</td>
                <td>{item.product_name}</td>
                {pricesOn && <td className={styles.numeric}>{formatRupees(item.unit_price_paise)}</td>}
                {pricesOn && <td className={styles.numeric}>{formatRupees(item.line_total_paise)}</td>}
              </tr>
            ))}
            {pricesOn && (
              <tr className={styles.totalRow}>
                <td />
                <td>Total (incl. GST)</td>
                <td />
                <td className={styles.numeric}>{formatRupees(totalPaise)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {notes && <p className={styles.notesBox}>Notes: {notes}</p>}

        <div className={styles.signatures}>
          <span className={styles.signatureLine}>Packed by</span>
          <span className={styles.signatureLine}>Checked by</span>
        </div>

        <p className={styles.footer}>
          GANPATI ENTERPRISES · ORDER CAPTURE — Printed {formatFullTimestamp(new Date(printedAt).toISOString())} · page 1 of 1
        </p>
      </div>
    </div>
  );
}
