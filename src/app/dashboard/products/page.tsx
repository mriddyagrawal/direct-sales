import { createClient } from "@/lib/supabase/server";
import { ProductsPricing } from "./ProductsPricing";
import type { BrandOption } from "./ProductModal";

export interface ProductRow {
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

// Owner-added deliverable — pricing deferred to Supabase Studio in the
// original spec, overridden 2026-07-07: build an in-app screen instead.
// M5.5 reworked it into the catalog ledger + Add/Edit modal (admin-only add).
export default async function ProductsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // products_select_staff (RLS) returns every row incl. unpriced/inactive —
  // the salesman-facing filter (active AND priced, D2) does not apply here.
  const [{ data }, { data: brandRows }, { data: profile }] = await Promise.all([
    supabase
      .from("products")
      .select("id, brand_id, category, name, price_paise, active, tally_name, stock_qty, stock_updated_at, brands(name, show_model)")
      .order("category")
      .order("name"),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
    supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  return (
    <ProductsPricing
      initialProducts={(data ?? []) as unknown as ProductRow[]}
      brands={(brandRows ?? []) as BrandOption[]}
      isAdmin={profile?.role === "admin"}
    />
  );
}
