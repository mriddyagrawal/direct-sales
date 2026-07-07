import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

// Thin wrappers around the four write RPCs (supabase/migrations/
// 20260706T150400_rpcs.sql). The client only ever sends product_id + qty —
// prices are snapshotted server-side from the catalog inside the RPC; never
// collect or send a price here. A zero/removed line must never reach the
// payload — the DB's `qty between 1 and 9999` check would reject the whole
// order (review flag ㉔); filter defensively here, not just at the caller.
function toItemsPayload(items: Record<string, number>) {
  return Object.entries(items)
    .filter(([, qty]) => qty > 0)
    .map(([product_id, qty]) => ({ product_id, qty }));
}

// A network failure (offline, DNS, timeout) throws before the server ever
// sees the request — retryable. A rejection returned BY the server (window
// expired, product now unpriced, etc.) is authoritative and must be shown
// plainly, never silently queued for retry.
//
// review flag ㉗: this message is deliberately neutral — only submitOrder's
// caller (NewOrderFlow, create mode) actually queues + auto-retries via
// lib/pending-orders.ts. update_order_items/cancel_order have no such queue;
// a caller-specific "will retry automatically" claim belongs in their own UI
// copy, not baked in here where it would overpromise for edit/cancel.
export class OfflineError extends Error {}

interface RpcErrorLike {
  message: string;
  code?: string;
}

// review flag ㉓: navigator.onLine alone is not reliable — it reports "has a
// link," not "can reach the server," so a captive portal/DNS failure/flaky
// signal can resolve (not throw) with an error while onLine still reads
// true. A genuine Postgres rejection always carries a SQLSTATE in `code`
// (P0001 from `raise exception`, 23505 from a constraint, ...); a resolved
// transport failure has none. Treat "no code" as offline too, or a real
// rejection would occasionally get misclassified as a real one and vice
// versa — silently dropping a submission that should have retried.
function isOfflineFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error && typeof error === "object" && "message" in error) {
    return !(error as RpcErrorLike).code;
  }
  return false;
}

async function callRpc<T>(fn: () => PromiseLike<{ data: T | null; error: RpcErrorLike | null }>): Promise<T> {
  let result;
  try {
    result = await fn();
  } catch (error) {
    if (isOfflineFailure(error)) throw new OfflineError("You're offline. Check your connection and try again.");
    throw error;
  }
  if (result.error) {
    if (isOfflineFailure(result.error)) {
      throw new OfflineError("You're offline. Check your connection and try again.");
    }
    throw new Error(result.error.message);
  }
  return result.data as T;
}

export async function submitOrder(
  orderId: string,
  retailerId: string,
  notes: string,
  items: Record<string, number>,
): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("submit_order", {
      p_id: orderId,
      p_retailer_id: retailerId,
      p_notes: notes,
      p_items: toItemsPayload(items),
    }),
  );
}

export async function updateOrderItems(
  orderId: string,
  notes: string,
  items: Record<string, number>,
  reason?: string,
): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("update_order_items", {
      p_order_id: orderId,
      p_notes: notes,
      p_items: toItemsPayload(items),
      p_reason: reason,
    }),
  );
}

export async function cancelOrder(orderId: string, reason?: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("cancel_order", {
      p_order_id: orderId,
      p_reason: reason,
    }),
  );
}

export async function processOrder(orderId: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("process_order", { p_order_id: orderId }));
}
