import { createClient } from "@/lib/supabase/client";
import { getQueryClient } from "@/lib/query-client";
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
  // D7 (client-data-cache spec): every RPC in this file mutates `orders`, so
  // ONE success hook here covers all of them — the ["orders"] cache prefix is
  // invalidated and the actor's own lists correct without a manual reload
  // (other devices converge via Realtime/focus-refetch). Fire-and-forget: the
  // background refetch must never delay the caller's own success transition.
  // These helpers only run in client components; on a stray server call
  // getQueryClient() is a fresh empty client and this is a no-op.
  void getQueryClient().invalidateQueries({ queryKey: ["orders"] });
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

// `retailerId` is honored ONLY for an admin (server-enforced) — a non-admin's
// value is ignored, never changing the order's retailer. `prices` now carries
// the admin's all-brand overrides too (fixed brands included); the RPC trusts a
// client price for a manual brand OR when the caller is admin, otherwise the
// snapshot/catalog wins (untamperable holds).
export async function updateOrderItems(
  orderId: string,
  notes: string,
  items: Record<string, number>,
  reason?: string,
  prices?: Record<string, number>,
  retailerId?: string,
): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("update_order_items", {
      p_order_id: orderId,
      p_notes: notes,
      p_items: toItemsPayload(items, prices),
      p_reason: reason,
      p_retailer_id: retailerId,
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

// Billing requires the Tally bill number (server validates non-empty; the UI
// blocks empty too). btrim/normalisation is server-side — send it verbatim.
export async function processOrder(orderId: string, billNo: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("process_order", { p_order_id: orderId, p_bill_no: billNo }));
}

export async function approveOrder(orderId: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("approve_order", { p_order_id: orderId }));
}

// Mark a billed order as physically shipped (billed → dispatched). Caller must
// be godown/accountant/admin (enforced server-side); never the salesman.
export async function dispatchOrder(orderId: string, note?: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("dispatch_order", { p_order_id: orderId, p_note: note }));
}

// Promote a backorder back into the pipeline (backorder → pending_approval).
// Caller must be the order's salesman or an admin (enforced server-side).
export async function punchOrder(orderId: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("punch_order", { p_order_id: orderId }));
}

// Admin "Undo": walk the order ONE stage backward (approved→pending_approval,
// ready_to_bill→approved un-pick, billed→ready_to_bill un-bill,
// dispatched→billed). Admin-only, reason-free (server audits a 'stepped_back'
// event). An un-pick with an ADVANCED backorder child raises
// "blocked: finish or cancel backorder <ref> first" — surfaced with a link.
export async function stepBackOrder(orderId: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("step_back_order", { p_order_id: orderId }));
}

// Admin-only note on a pending_approval order (owner decision 2026-07-11) — one
// overwritable comment; submitting an empty string CLEARS it. The server gates
// admin + pending-only; the note rides the RLS'd order row (everyone who can see
// the order sees it). Cleared automatically when the order is approved.
export async function setAdminComment(orderId: string, comment: string): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("set_admin_comment", { p_order_id: orderId, p_comment: comment }));
}

// Godown pick submission (any active role; a salesman is scoped to his own
// order server-side). ONE line per ordered item, brand-aware + partial:
//   • LG (requires_scan): send the picked units' RAW scans — serial derived
//     server-side, one per picked unit; scanning fewer than ordered is a
//     partial pick.
//   • Zeb/Lum: send `picked_qty` (0..ordered); no serials.
// A short pick splits the order server-side — the original ships the picked
// qty (→ ready_to_bill), a new `backorder` child holds the remainder. At
// least one unit across the order is required.
export interface PickLineInput {
  order_item_id: string;
  picked_qty?: number;
  scans?: string[];
}

export async function submitPick(orderId: string, lines: PickLineInput[]): Promise<OrderRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("submit_pick", {
      p_order_id: orderId,
      p_lines: lines as unknown as Database["public"]["Functions"]["submit_pick"]["Args"]["p_lines"],
    }),
  );
}
