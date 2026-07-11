import { Button } from "@/components/ui/Button";
import { StatusTag } from "@/components/ui/StatusTag";
import { formatRupees } from "@/lib/format";
import styles from "./Confirmation.module.css";

interface ConfirmationProps {
  orderRef: string;
  totalPaise: number;
  retailerName: string;
  onBackHome: () => void;
  onViewOrder: () => void;
}

// S6 — renders only on confirmed server success (data-model.md: an order
// only exists once submit_order has actually returned it).
export function Confirmation({ orderRef, totalPaise, retailerName, onBackHome, onViewOrder }: ConfirmationProps) {
  return (
    <div className={styles.page}>
      <div className={styles.check} aria-hidden>
        ✓
      </div>
      <p className={styles.title}>ORDER SUBMITTED</p>
      <p className={styles.ref}>{orderRef}</p>
      <p className={styles.meta}>
        {retailerName} · {formatRupees(totalPaise)}
      </p>
      <StatusTag tone="accent" label="Editable until approved" />
      <div className={styles.actions}>
        <Button variant="primary" onClick={onBackHome}>
          Back to Home
        </Button>
        <button type="button" className={styles.viewLink} onClick={onViewOrder}>
          View order
        </button>
      </div>
    </div>
  );
}
