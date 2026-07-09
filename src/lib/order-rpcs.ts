import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

// Thin wrappers around the write RPCs. For FIXED brands the client sends only
// product_id + qty — the price is snapshotted server-side from the catalog and
// any client price is ignored (untamperable). For MANUAL brands (LG, Phase 3b)
// the salesman's entered unit price is sent as `unit_price_paise`; the RPC
// trusts it only for manual-brand lines (validate > 0, ceiling, no floor).
// A zero/removed line must never reach the payload — the DB's
// `qty between 1 and 9999` check would reject the whole order (review flag ㉔);
// filter defensively here, not just at the caller.
function toItemsPayload(items: Record<string, number>, prices?: Record<string, number>) {
  return Object.entries(items)
    .filter(([, qty]) => qty > 0)
    .map(([product_id, qty]) =>
      prices && prices[product_id] != null
        ? { product_id, qty, unit_price_paise: prices[product_id] }
        : { product_id, qty },
    );
}

// A network failure (offline, DNS, timeout) throws before the server ever
// sees the request — safely retryable by the user (idempotent order ids). A
// rejection returned BY the server (window expired, product now unpriced,
// etc.) is authoritative and must be shown plainly.
//
// The offline retry QUEUE is gone (owner decision 2026-07-10) — this class
// now exists purely so callers can show the right words: "you're offline,
// try again" vs a real rejection. Nothing queues, nothing auto-retries.
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
  prices?: Record<string, number>,
): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("submit_order", {
      p_id: orderId,
      p_retailer_id: retailerId,
      p_notes: notes,
      p_items: toItemsPayload(items, prices),
    }),
  );
}

export async function updateOrderItems(
  orderId: string,
  notes: string,
  items: Record<string, number>,
  reason?: string,
  prices?: Record<string, number>,
): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("update_order_items", {
      p_order_id: orderId,
      p_notes: notes,
      p_items: toItemsPayload(items, prices),
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

export async function approveOrder(orderId: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("approve_order", { p_order_id: orderId }));
}

// Godown pick submission (godown role only, LG/approval orders only). One
// batch per order: `scans` is one entry per physical unit, each carrying the
// RAW scanner output — the serial is derived server-side (authoritative);
// anything the client extracted is display-only. The RPC validates full
// per-line coverage and global serial uniqueness, then flips the order
// approved -> ready_to_bill.
export interface PickScan {
  order_item_id: string;
  raw_scan: string;
}

export async function submitPick(orderId: string, scans: PickScan[]): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("submit_pick", {
      p_order_id: orderId,
      p_scans: scans as unknown as Database["public"]["Functions"]["submit_pick"]["Args"]["p_scans"],
    }),
  );
}
