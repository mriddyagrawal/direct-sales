import Link from "next/link";
import { StatusTag, type StatusTone } from "@/components/ui/StatusTag";
import { formatRupees } from "@/lib/format";
import styles from "./OrderCard.module.css";

interface OrderCardProps {
  id: string;
  orderRef: string;
  totalPaise: number;
  retailerName: string;
  itemCount: number;
  statusTone: StatusTone;
  statusLabel: string;
}

// Ref (mono) + total (mono, right) on top; shop + item count below; status
// tag (design spec S2 "Cards"). Links to order detail (S7), which M4 builds.
export function OrderCard({
  id,
  orderRef,
  totalPaise,
  retailerName,
  itemCount,
  statusTone,
  statusLabel,
}: OrderCardProps) {
  return (
    <Link href={`/orders/${id}`} className={styles.card}>
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
    </Link>
  );
}
