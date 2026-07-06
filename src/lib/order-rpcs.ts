import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

// Thin wrappers around the four write RPCs (supabase/migrations/
// 20260706T150400_rpcs.sql). The client only ever sends product_id + qty —
// prices are snapshotted server-side from the catalog inside the RPC; never
// collect or send a price here.
function toItemsPayload(items: Record<string, number>) {
  return Object.entries(items).map(([product_id, qty]) => ({ product_id, qty }));
}

// A network failure (offline, DNS, timeout) throws before the server ever
// sees the request — retryable. A rejection returned BY the server (window
// expired, product now unpriced, etc.) is authoritative and must be shown
// plainly, never silently queued for retry.
export class OfflineError extends Error {}

function isOfflineFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  // supabase-js surfaces a fetch-level failure (no HTTP response at all) as
  // a plain TypeError ("Failed to fetch" / "Load failed"), distinct from a
  // PostgrestError (which has a `code`/`message` from Postgres itself).
  return error instanceof TypeError;
}

async function callRpc<T>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  let result;
  try {
    result = await fn();
  } catch (error) {
    if (isOfflineFailure(error)) throw new OfflineError("You're offline — this will retry automatically.");
    throw error;
  }
  if (result.error) {
    if (isOfflineFailure(result.error)) {
      throw new OfflineError("You're offline — this will retry automatically.");
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
): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("update_order_items", {
      p_order_id: orderId,
      p_notes: notes,
      p_items: toItemsPayload(items),
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
