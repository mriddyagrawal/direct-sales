"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  listPending,
  listPendingSnapshot,
  getServerSnapshotPending,
  subscribePending,
  removePending,
  type PendingOrder,
} from "@/lib/pending-orders";
import { clearDraft, clearLastActiveRetailerId } from "@/lib/cart";
import { submitOrder, OfflineError } from "@/lib/order-rpcs";
import { formatRupees } from "@/lib/format";
import styles from "./PendingOrdersStrip.module.css";

// S2's pinned offline strip (design spec): an order that reached Submit but
// never got a confirmed server response stays visible here — "no silent
// loss, no silent duplication" — until it syncs, from any screen the
// salesman happens to be on, not just Review.
export function PendingOrdersStrip() {
  const router = useRouter();
  const pending = useSyncExternalStore(subscribePending, listPendingSnapshot, getServerSnapshotPending);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  async function sync(order: PendingOrder) {
    setSyncingId(order.orderId);
    try {
      await submitOrder(order.orderId, order.retailerId, order.notes, order.items);
      removePending(order.orderId);
      clearDraft(order.retailerId);
      clearLastActiveRetailerId();
      router.refresh();
    } catch (error) {
      if (!(error instanceof OfflineError)) removePending(order.orderId); // a real server rejection — stop retrying it forever
    } finally {
      setSyncingId(null);
    }
  }

  useEffect(() => {
    function handleOnline() {
      for (const order of listPending()) sync(order);
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pending.length === 0) return null;

  return (
    <>
      {pending.map((order) => (
        <div key={order.orderId} className={styles.strip}>
          <p className={styles.title}>Saved on phone — not submitted yet</p>
          <p className={styles.meta}>
            {order.retailerName} · {order.itemCount} {order.itemCount === 1 ? "item" : "items"} ·{" "}
            {formatRupees(order.totalPaise)}
          </p>
          <p className={styles.microcopy}>PENDING · WILL RETRY WHEN ONLINE · NO DUPLICATE</p>
          <button
            type="button"
            className={styles.syncLink}
            onClick={() => sync(order)}
            disabled={syncingId === order.orderId}
          >
            {syncingId === order.orderId ? "Syncing…" : "Sync now"}
          </button>
        </div>
      ))}
    </>
  );
}
