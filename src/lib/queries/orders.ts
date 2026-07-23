import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// THE orders-list query — spec D12: it exists exactly ONCE, parameterized by
// the Supabase client, imported by BOTH the server pages (first paint /
// prefetch) and the browser queryFn (background refetches). Same embeds, same
// sort, same cap, by construction — drift here means rows flash/vanish ~1s
// after every visit, so never fork this per-surface.
//
// Cache-key contract (spec D4): ["orders", scope] with NO uid in the key is
// only safe because (a) the cache is per-tab memory wiped on every auth
// transition (D9), and (b) every scope is a bounded fetch-all (limit 300) with
// client-side filtering. If any scope ever moves to server-side filtering or
// pagination, its key MUST grow those params.

export interface OrderListRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  total_paise: number;
  status: string;
  editable_until: string;
  cancelled_by: string | null;
  admin_comment: string | null;
  salesman_id: string;
  brand_id: string;
  retailers: { name: string; verified: boolean } | null;
  profiles: { full_name: string } | null;
  brands: { name: string; code: string } | null;
}

export type OrdersScope = "salesman" | "staff" | "godown-home" | "godown-dispatch";

export const ORDERS_LIST_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, admin_comment, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)";

// Godown Home's pipeline statuses — also feeds that page's statusScope/tabs
// props, so the query and the chip-tabs can't drift apart.
export const GODOWN_HOME_STATUSES = ["approved", "ready_to_bill", "billed", "dispatched"];

// uid feeds ONLY the salesman scope's D8 clause (a self-cancelled order reads
// as "never happened"; an office-cancel stays visible). RLS is what actually
// scopes rows to the caller — staff/godown pass uid unused.
//
// Throws on a DB error (the TanStack queryFn contract; retries/D13 depend on
// it) — callers must not swallow the result into a silent empty list.
export async function fetchOrdersList(
  supabase: SupabaseClient<Database>,
  scope: OrdersScope,
  uid: string,
): Promise<OrderListRow[]> {
  // Filters chained BEFORE order/limit so the generated querystring is
  // byte-identical to the old inline page queries (parity-verified offline).
  let q = supabase.from("orders").select(ORDERS_LIST_SELECT);
  if (scope === "salesman") q = q.or(`status.neq.cancelled,cancelled_by.neq.${uid}`);
  else if (scope === "godown-home") q = q.in("status", GODOWN_HOME_STATUSES);
  else if (scope === "godown-dispatch") q = q.eq("status", "billed");

  const { data, error } = await q.order("submitted_at", { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as OrderListRow[];
}
