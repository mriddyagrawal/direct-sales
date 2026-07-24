import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { fetchBrowseProducts, type BrowseProductRow } from "@/lib/queries/products";
import { TopStrip } from "@/components/TopStrip";
import { BottomTabBar } from "@/components/BottomTabBar";
import { ProductsBrowse } from "./ProductsBrowse";
import styles from "./products.module.css";

// The row shape + query (incl. the brand flattening) live in the shared
// builder (spec D12); re-exported so existing importers keep working.
export type ProductRow = BrowseProductRow;

// Read-only salesman Products reference (owner 2026-07-23): a pricelist +
// stocklist + search he can pull up mid-conversation — no retailer, no cart, no
// editing. Same RLS-scoped catalog the Quick Order flow already reads — no new
// fetch privileges, no DB change. Prefetch → dehydrate seeds the client cache
// (per-request query client, spec D2); ProductsBrowse owns it via useQuery.
export default async function ProductsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const queryClient = getQueryClient();
  const [, { data: profile }] = await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["products", "browse"],
      queryFn: () => fetchBrowseProducts(supabase),
    }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user.email ?? ""} />
      <div className={styles.content}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <ProductsBrowse />
        </HydrationBoundary>
      </div>
      <BottomTabBar />
    </div>
  );
}
