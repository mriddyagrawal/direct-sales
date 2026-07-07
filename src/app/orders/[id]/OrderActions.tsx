"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { cancelOrder } from "@/lib/order-rpcs";
import styles from "./OrderActions.module.css";

interface OrderActionsProps {
  orderId: string;
}

// S7 — only rendered by the page while the order is still editable for its
// owning salesman (data-model.md's "locked" is derived; the UI mirrors it by
// simply not mounting these buttons past the window — removed, not disabled).
export function OrderActions({ orderId }: OrderActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      await cancelOrder(orderId);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the order.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <div className={styles.actions}>
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Cancel order
        </Button>
        <Button variant="primary" onClick={() => router.push(`/new-order?edit=${orderId}`)}>
          Edit order
        </Button>
      </div>

      {confirming && (
        <BottomSheet onClose={() => setConfirming(false)}>
          <p className={styles.confirmTitle}>Cancel this order?</p>
          <p className={styles.confirmBody}>This can&apos;t be undone.</p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.confirmActions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep order
            </Button>
            <Button variant="destructive-filled" onClick={handleCancel} loading={cancelling}>
              Cancel order
            </Button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
