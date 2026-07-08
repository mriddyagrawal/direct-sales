"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  listPending,
  listPendingSnapshot,
  getServerSnapshotPending,
  subscribePending,
  removePending,
  markPendingFailed,
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
      await submitOrder(order.orderId, order.retailerId, order.notes, order.items, order.prices);
      removePending(order.orderId);
      clearDraft(order.retailerId);
      clearLastActiveRetailerId();
      router.refresh();
    } catch (error) {
      if (!(error instanceof OfflineError)) {
        // review flag ㉖ — a real rejection (not offline) is permanent, so
        // retrying the identical payload again is pointless, but silently
        // discarding it would read exactly like success. Keep it, tagged
        // with why, until the salesman actually sees and acts on it.
        markPendingFailed(order.orderId, error instanceof Error ? error.message : "Could not submit this order.");
      }
    } finally {
      setSyncingId(null);
    }
  }

  useEffect(() => {
    function handleOnline() {
      // Only auto-retry orders that haven't already failed for real — a
      // permanent rejection won't succeed on a second identical attempt;
      // that one only retries when the salesman explicitly taps Retry.
      for (const order of listPending()) if (!order.lastError) sync(order);
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pending.length === 0) return null;

  return (
    <>
      {pending.map((order) => (
        <div key={order.orderId} className={order.lastError ? styles.stripFailed : styles.strip}>
          <p className={styles.title}>
            {order.lastError ? "Couldn't submit this order" : "Saved on phone — not submitted yet"}
          </p>
          <p className={styles.meta}>
            {order.retailerName} · {order.itemCount} {order.itemCount === 1 ? "item" : "items"} ·{" "}
            {formatRupees(order.totalPaise)}
          </p>
          {order.lastError ? (
            <p className={styles.microcopy}>{order.lastError}</p>
          ) : (
            <p className={styles.microcopy}>PENDING · WILL RETRY WHEN ONLINE · NO DUPLICATE</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.syncLink}
              onClick={() => sync(order)}
              disabled={syncingId === order.orderId}
            >
              {syncingId === order.orderId ? "Syncing…" : order.lastError ? "Try again" : "Sync now"}
            </button>
            {order.lastError && (
              <button type="button" className={styles.syncLink} onClick={() => removePending(order.orderId)}>
                Discard
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
