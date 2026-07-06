import { StatusTag, type StatusTone } from "@/components/ui/StatusTag";
import { formatRupees } from "@/lib/format";
import styles from "./OrderCard.module.css";

interface OrderCardProps {
  orderRef: string;
  totalPaise: number;
  retailerName: string;
  itemCount: number;
  statusTone: StatusTone;
  statusLabel: string;
}

// Ref (mono) + total (mono, right) on top; shop + item count below; status
// tag (design spec S2 "Cards"). Not a link yet — order detail (S7/S9) is
// M4/M5, not this milestone; wiring a href here would point at a route
// that doesn't exist.
export function OrderCard({
  orderRef,
  totalPaise,
  retailerName,
  itemCount,
  statusTone,
  statusLabel,
}: OrderCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.topRow}>
        <span className={styles.ref}>{orderRef}</span>
        <span className={styles.total}>{formatRupees(totalPaise)}</span>
      </div>
      <div className={styles.bottomRow}>
        <span className={styles.retailer}>
          {retailerName} · {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        <StatusTag tone={statusTone} label={statusLabel} />
      </div>
    </div>
  );
}
