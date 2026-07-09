"use client";

import { useState } from "react";
import { formatFullTimestamp, formatRupees } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { ShareOrderButton } from "@/components/ShareOrderButton";
import { buildOrderShareText } from "@/lib/order-share";
import styles from "./PickSlip.module.css";

interface PickSlipItem {
  product_name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  tally_name: string | null;
}

interface PickSlipProps {
  orderId: string;
  orderRef: string;
  submittedAt: string;
  notes: string;
  totalPaise: number;
  retailerName: string;
  retailerArea: string | null;
  retailerPhone: string | null;
  salesmanName: string;
  brandName: string | null;
  showModel: boolean;
  items: PickSlipItem[];
}

// S10 — the order-copy sheet (accountant/admin). Always shows prices
// (owner decision — the godown reads qty in the /godown pick flow, not this
// sheet). The on-screen sheet is the visual preview; "Download PDF" links to
// the sibling pdf route, which streams a real generated A5 PDF (the phone's
// native viewer opens it → share to WhatsApp).
export function PickSlip({
  orderId,
  orderRef,
  submittedAt,
  notes,
  totalPaise,
  retailerName,
  retailerArea,
  retailerPhone,
  salesmanName,
  brandName,
  showModel,
  items,
}: PickSlipProps) {
  const [printedAt] = useState(nowMs);

  // Prices are always shown now (owner decision) — this is an ORDER COPY.
  const shareText = buildOrderShareText({
    orderRef,
    brandName,
    submittedAt,
    retailerName,
    retailerArea,
    retailerPhone,
    salesmanName,
    items,
    totalPaise,
    notes,
    withPrices: true,
  });

  return (
    <div className={styles.page}>
      <div className={styles.chrome}>
        <span className={styles.chromeTitle}>
          {orderRef} · ORDER COPY
        </span>
        <div className={styles.chromeControls}>
          <a
            href={`/dashboard/orders/${orderId}/pick-slip/pdf`}
            target="_blank"
            rel="noopener"
            className={styles.printButton}
          >
            Download PDF
          </a>
          <ShareOrderButton title={orderRef} text={shareText} className={styles.printButton} />
        </div>
      </div>

      <div className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <div>
            <p className={styles.brand}>GANPATI ENTERPRISES</p>
            <p className={styles.ref}>{orderRef}</p>
            {brandName && <p className={styles.slipBrand}>{brandName}</p>}
          </div>
          <span className={styles.badge}>ORDER COPY</span>
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
              <th className={styles.numeric}>RATE</th>
              <th className={styles.numeric}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td className={styles.qtyCell}>{item.qty}</td>
                <td>
                  {item.product_name}
                  {showModel && item.tally_name && item.tally_name !== item.product_name && (
                    <span className={styles.slipModel}>{item.tally_name}</span>
                  )}
                </td>
                <td className={styles.numeric}>{formatRupees(item.unit_price_paise)}</td>
                <td className={styles.numeric}>{formatRupees(item.line_total_paise)}</td>
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td />
              <td>Total (incl. GST)</td>
              <td />
              <td className={styles.numeric}>{formatRupees(totalPaise)}</td>
            </tr>
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
