// Orders that reached "Submit" but couldn't be confirmed by the server yet
// (offline, or a request that never got a response). Distinct from
// DraftCart (lib/cart.ts): a pending order has already left the Review
// screen's editable state and is purely waiting to be retried with its
// original client-generated id — resilience.md's "no silent loss, no
// silent duplication."
export interface PendingOrder {
  orderId: string;
  retailerId: string;
  retailerName: string;
  notes: string;
  items: Record<string, number>; // product_id -> qty
  itemCount: number;
  totalPaise: number; // display-only estimate from catalog prices at submit time
  savedAt: number;
}

const KEY = "directsales:pending-orders";

export function listPending(): PendingOrder[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingOrder[];
  } catch {
    return [];
  }
}

export function savePending(order: PendingOrder): void {
  if (typeof window === "undefined") return;
  const rest = listPending().filter((o) => o.orderId !== order.orderId);
  window.localStorage.setItem(KEY, JSON.stringify([...rest, order]));
}

export function removePending(orderId: string): void {
  if (typeof window === "undefined") return;
  const rest = listPending().filter((o) => o.orderId !== orderId);
  window.localStorage.setItem(KEY, JSON.stringify(rest));
}
