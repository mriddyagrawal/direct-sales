import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// THE Quick Order catalog query — spec D12/D4: one builder, key ["catalog"].
// Safe to cache (owner call): submit_order re-prices fixed brands server-side,
// so a stale picker price cannot produce a wrong order; manual (LG) prices are
// typed by the salesman anyway. The brand flattening lives HERE so the server
// seed and the client refetch produce byte-identical rows.
// RLS (D2) scopes a salesman to active AND priced products; staff see more —
// same query, per-role rows, exactly like the old inline page fetch.

export interface CatalogProduct {
  id: string;
  category: string;
  name: string;
  tally_name: string; // model / Tally name; shown left of name when brand.show_model
  price_paise: number | null; // null for manual-pricing (LG) products — no catalog price
  brand_id: string;
  brand_name: string;
  pricing_mode: string; // 'fixed' | 'manual'
  show_model: boolean; // brand flag — render "{tally_name}・{name}" when true
  stock_qty: number | null; // godown stock from the last Tally sync; null = never synced
  stock_updated_at: string | null; // "as of" for the stock figure
}

export async function fetchCatalog(supabase: SupabaseClient<Database>): Promise<CatalogProduct[]> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, category, name, tally_name, price_paise, brand_id, stock_qty, stock_updated_at, brands(name, pricing_mode, show_model)",
    )
    .order("category")
    .order("created_at");
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    category: string;
    name: string;
    tally_name: string;
    price_paise: number | null;
    brand_id: string;
    stock_qty: number | null;
    stock_updated_at: string | null;
    brands: { name: string; pricing_mode: string; show_model: boolean } | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    tally_name: r.tally_name,
    price_paise: r.price_paise,
    brand_id: r.brand_id,
    brand_name: r.brands?.name ?? "",
    pricing_mode: r.brands?.pricing_mode ?? "fixed",
    show_model: r.brands?.show_model ?? false,
    stock_qty: r.stock_qty,
    stock_updated_at: r.stock_updated_at,
  }));
}
