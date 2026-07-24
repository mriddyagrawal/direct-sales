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
}

export async function fetchRetailers(supabase: SupabaseClient<Database>): Promise<RetailerRow[]> {
  const { data, error } = await supabase
    .from("retailers")
    .select("id, name, area, phone, verified, active")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RetailerRow[];
}
