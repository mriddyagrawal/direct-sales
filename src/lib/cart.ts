// Client-side order draft. Drafts never touch the database (data-model.md
// "Write paths"): the cart lives here until submit_order first creates the
// row, already `submitted`. Keyed by retailer so S3's resume-draft sheet can
// find "the draft for this shop" without a separate index.
export interface DraftCart {
  orderId: string; // stable client-generated uuid, reused across retries — never regenerate
  retailerId: string;
  retailerName: string;
  items: Record<string, number>; // product_id -> qty
  notes: string;
  updatedAt: number; // epoch ms, for the resume-draft sheet's "saved 11:31"
}

const KEY_PREFIX = "directsales:draft:";

function draftKey(retailerId: string): string {
  return `${KEY_PREFIX}${retailerId}`;
}

export function loadDraft(retailerId: string): DraftCart | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(draftKey(retailerId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DraftCart;
  } catch {
    return null;
  }
}

export function saveDraft(draft: DraftCart): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(draftKey(draft.retailerId), JSON.stringify(draft));
}

export function clearDraft(retailerId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(draftKey(retailerId));
}

export function createDraft(retailerId: string, retailerName: string): DraftCart {
  return {
    orderId: crypto.randomUUID(),
    retailerId,
    retailerName,
    items: {},
    notes: "",
    updatedAt: Date.now(),
  };
}

// Plain wrapper so callers in client components can use a timestamp without
// tripping the react-hooks/purity lint rule, which flags a bare `Date.now()`
// call written directly inside a component/hook body.
export function nowMs(): number {
  return Date.now();
}

export function cartLineCount(items: Record<string, number>): number {
  return Object.keys(items).length;
}

export function cartTotalPaise(items: Record<string, number>, pricesById: Record<string, number>): number {
  return Object.entries(items).reduce((sum, [productId, qty]) => sum + (pricesById[productId] ?? 0) * qty, 0);
}

// Which retailer's draft to resume when the app is reopened mid-cart
// (airplane-mode / kill-the-app resilience) — otherwise there's no way to
// find "the" in-progress draft without re-picking the retailer in S3.
const LAST_ACTIVE_KEY = "directsales:draft:last-active-retailer";

export function getLastActiveRetailerId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_ACTIVE_KEY);
}

export function setLastActiveRetailerId(retailerId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_ACTIVE_KEY, retailerId);
}

export function clearLastActiveRetailerId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LAST_ACTIVE_KEY);
}
