import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// THE retailers query — spec D12 + D4(b): ONE superset builder serves BOTH
// surfaces (the dashboard verification queue and the Quick Order retailer
// picker) under the single ["retailers"] key. The queue needs
// phone/verified/active; the picker reads a subset of the same columns —
// two different selects under one key would drift, and the extra bytes are
// harmless at ~600 rows. RLS scopes rows per role; the builder adds no filter
// (matches both old inline queries, which didn't either).

export interface RetailerRow {
  id: string;
  name: string;
  area: string | null;
  phone: string | null;
  verified: boolean;
  active: boolean;
  // The name the nightly Tally sync matches on (`_apply_ledger` keys on THIS
  // column only — never on `name`, so a shop rename can't re-point real money
  // at the wrong ledger). Nullable in the DB; a row with it empty syncs
  // nothing, which is why both retailer cards now write it.
  tally_ledger_name: string | null;
  // Written by the nightly Tally sync. NULL means this shop matched NOTHING in
  // the last run — "not in the last sync", never ₹0 (0 is a real, square
  // balance). The office queue surfaces that as its own tab + badge.
  outstanding_paise: number | null;
}

// The column list, once. Both retailer-detail routes (staff and salesman) read
// a single row with exactly these columns, and the list builder below reads
// many — one RetailerRow shape means one select, the same way
// ORDER_DETAIL_SELECT serves all three order-detail routes. Three hand-typed
// copies of a column list is how a lens quietly ends up missing a field.
export const RETAILER_SELECT = "id, name, area, phone, verified, active, tally_ledger_name, outstanding_paise";

export async function fetchRetailers(supabase: SupabaseClient<Database>): Promise<RetailerRow[]> {
  const { data, error } = await supabase
    .from("retailers")
    .select(RETAILER_SELECT)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RetailerRow[];
}
