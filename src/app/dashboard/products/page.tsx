import { createClient } from "@/lib/supabase/server";
import { ProductsPricing } from "./ProductsPricing";

export interface ProductRow {
  id: string;
  category: string;
  name: string;
  price_paise: number | null;
  active: boolean;
  tally_name: string;
}

// Owner-added deliverable — pricing deferred to Supabase Studio in the
// original spec, overridden 2026-07-07: build an in-app screen instead.
// accountant-dashboard.md §5 updated in the same commit as this page.
export default async function ProductsPage() {
  const supabase = await createClient();
  // products_select_staff (RLS) returns every row incl. unpriced/inactive —
  // the salesman-facing filter (active AND priced, D2) does not apply here.
  const { data } = await supabase
    .from("products")
    .select("id, category, name, price_paise, active, tally_name")
    .order("category")
    .order("name");

  return <ProductsPricing initialProducts={(data ?? []) as ProductRow[]} />;
}
