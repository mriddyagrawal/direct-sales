import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TopStrip } from "@/components/TopStrip";
import { BottomTabBar } from "@/components/BottomTabBar";
import { ProductsBrowse } from "./ProductsBrowse";
import styles from "./products.module.css";

export interface ProductRow {
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

// Read-only salesman Products reference (owner 2026-07-23): a pricelist +
// stocklist + search he can pull up mid-conversation — no retailer, no cart, no
// editing. Same RLS-scoped catalog the Quick Order flow already reads (same
// select, minus pricing_mode) — no new fetch privileges, no DB change.
export default async function ProductsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: productRows }, { data: profile }] = await Promise.all([
    supabase
      .from("products")
      .select("id, category, name, tally_name, price_paise, brand_id, stock_qty, stock_updated_at, brands(name, show_model)")
      .order("category"),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const products = (
    (productRows ?? []) as unknown as Array<{
      id: string;
      category: string;
      name: string;
      tally_name: string;
      price_paise: number | null;
      brand_id: string;
      stock_qty: number | null;
      stock_updated_at: string | null;
      brands: { name: string; show_model: boolean } | null;
    }>
  ).map((r) => ({
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
  })) as ProductRow[];

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user.email ?? ""} />
      <div className={styles.content}>
        <ProductsBrowse products={products} />
      </div>
      <BottomTabBar />
    </div>
  );
}
