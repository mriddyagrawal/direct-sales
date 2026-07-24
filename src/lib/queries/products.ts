import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// THE products queries — spec D12: each list exists ONCE, imported by both
// the server page (prefetch) and the browser queryFn (background refetches).
// Two shapes on purpose:
//   • ADMIN ledger (["products", "admin"]) — every column incl. `active`,
//     nested brands; RLS (products_select_staff) returns every row.
//   • SALESMAN browse (["products", "browse"]) — read-only pricelist,
//     FLATTENED brand fields (the page's old mapping moved here so server
//     seed and client refetch produce byte-identical rows); RLS (D2) already
//     filters to active AND priced for a salesman session.
// Cache-key contract (spec D4): coarse keys are safe only because both are
// fetch-alls under the row cap with client-side filtering, and the cache dies
// on every auth transition (D9).

export interface AdminProductRow {
  id: string;
  brand_id: string;
  category: string;
  name: string;
  price_paise: number | null;
  active: boolean;
  tally_name: string;
  stock_qty: number | null; // null = never synced from Tally
  stock_updated_at: string | null; // per-row "as of"
  brands: { name: string; show_model: boolean } | null;
}

export interface BrowseProductRow {
  id: string;
  category: string;
  name: string;
  tally_name: string;
  price_paise: number | null;
  brand_id: string;
  brand_name: string;
  show_model: boolean;
  stock_qty: number | null;
  stock_updated_at: string | null;
}

export async function fetchAdminProducts(supabase: SupabaseClient<Database>): Promise<AdminProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, brand_id, category, name, price_paise, active, tally_name, stock_qty, stock_updated_at, brands(name, show_model)")
    .order("category")
    .order("name");
  if (error) throw error;
  return (data ?? []) as unknown as AdminProductRow[];
}

export async function fetchBrowseProducts(supabase: SupabaseClient<Database>): Promise<BrowseProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, category, name, tally_name, price_paise, brand_id, stock_qty, stock_updated_at, brands(name, show_model)")
    .order("category");
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<
    Omit<BrowseProductRow, "brand_name" | "show_model"> & { brands: { name: string; show_model: boolean } | null }
  >;
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    tally_name: r.tally_name,
    price_paise: r.price_paise,
    brand_id: r.brand_id,
    brand_name: r.brands?.name ?? "",
    show_model: r.brands?.show_model ?? false,
    stock_qty: r.stock_qty,
    stock_updated_at: r.stock_updated_at,
  }));
}
