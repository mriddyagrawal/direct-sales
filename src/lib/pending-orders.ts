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
const CHANGE_EVENT = "directsales:pending-orders-changed";

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

function notifyChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function savePending(order: PendingOrder): void {
  if (typeof window === "undefined") return;
  const rest = listPending().filter((o) => o.orderId !== order.orderId);
  window.localStorage.setItem(KEY, JSON.stringify([...rest, order]));
  notifyChange();
}

export function removePending(orderId: string): void {
  if (typeof window === "undefined") return;
  const rest = listPending().filter((o) => o.orderId !== orderId);
  window.localStorage.setItem(KEY, JSON.stringify(rest));
  notifyChange();
}

const EMPTY: PendingOrder[] = [];
let cachedRaw: string | null | undefined;
let cachedList: PendingOrder[] = EMPTY;

// useSyncExternalStore's getSnapshot must return a stable (===) reference
// when nothing changed, or React re-renders forever — listPending() above
// parses fresh JSON every call, so it can't be used directly as a snapshot.
export function listPendingSnapshot(): PendingOrder[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(KEY);
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  cachedList = raw ? (JSON.parse(raw) as PendingOrder[]) : EMPTY;
  return cachedList;
}

export function getServerSnapshotPending(): PendingOrder[] {
  return EMPTY;
}

// Subscribes to both same-tab mutations (savePending/removePending above)
// and cross-tab changes (the native `storage` event) — the pinned strip on
// Home should update no matter which tab/device is retrying.
export function subscribePending(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
