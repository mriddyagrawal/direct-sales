import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// THE deposits-list query — spec D12: one builder, both the server pages
// (prefetch) and the browser queryFn (background refetches) import it; the
// two shapes can't drift. RLS is what scopes rows (a salesman sees only his
// own, staff see all) — the builder adds no scope filter, only the cap.
//
// Cache-key contract (spec D4): ["deposits", scope] with no uid — safe only
// because the cache is per-tab memory wiped on every auth transition (D9) and
// each scope is a bounded fetch-all with client-side filtering. Server-side
// filtering/pagination someday ⇒ the key MUST grow those params.

// One row off the deposits query (retailer + salesman names embedded).
// amount_paise is the GROSS knocked off the balance; discount_paise the
// concession; the money in hand is depositNetPaise(amount, discount) — every
// total a human reconciles against cash MUST sum the net (deposit-fields.ts).
// receipt_ref is the paper-book number; null on rows that predate it.
export interface DepositListRow {
  id: string;
  deposit_ref: string;
  amount_paise: number;
  discount_paise: number;
  previous_outstanding_paise: number | null;
  receipt_ref: string | null;
  method: string;
  note: string | null;
  created_at: string;
  editable_until: string;
  salesman_id: string;
  voided_at: string | null;
  void_reason: string | null;
  retailers: { name: string } | null;
  profiles: { full_name: string } | null;
  // Actions only — enough to badge an edited row. RLS on deposit_events is
  // staff-only, so on the salesman scope this embed arrives EMPTY (filtered,
  // not an error): the badge is structurally staff-only without branching
  // the builder. The full trail is fetched lazily on expand.
  deposit_events: { action: string }[];
}

export type DepositsScope = "salesman" | "staff";

export const DEPOSITS_LIST_SELECT =
  "id, deposit_ref, amount_paise, discount_paise, previous_outstanding_paise, receipt_ref, method, note, created_at, editable_until, salesman_id, voided_at, void_reason, retailers(name), profiles!deposits_salesman_id_fkey(full_name), deposit_events(action)";

// Caps carried over verbatim from the old inline page queries: the office
// reconciles a longer horizon (1000) than a salesman's personal ledger (500).
// Throws on a DB error (TanStack queryFn contract).
export async function fetchDepositsList(
  supabase: SupabaseClient<Database>,
  scope: DepositsScope,
): Promise<DepositListRow[]> {
  const { data, error } = await supabase
    .from("deposits")
    .select(DEPOSITS_LIST_SELECT)
    .order("created_at", { ascending: false })
    .limit(scope === "staff" ? 1000 : 500);
  if (error) throw error;
  return (data ?? []) as unknown as DepositListRow[];
}
