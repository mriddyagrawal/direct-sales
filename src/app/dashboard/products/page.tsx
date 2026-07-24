import { createClient } from "@/lib/supabase/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { fetchAdminProducts, type AdminProductRow } from "@/lib/queries/products";
import { ProductsPricing } from "./ProductsPricing";
import type { BrandOption } from "./ProductModal";

// The row shape + query live in the shared builder (spec D12); re-exported so
// existing importers (ProductsPricing, ProductModal, wizards) keep working.
export type ProductRow = AdminProductRow;

// Owner-added deliverable — pricing deferred to Supabase Studio in the
// original spec, overridden 2026-07-07: build an in-app screen instead.
// M5.5 reworked it into the catalog ledger + Add/Edit modal (admin-only add).
// products_select_staff (RLS) returns every row incl. unpriced/inactive — the
// salesman-facing filter (active AND priced, D2) does not apply here.
// Prefetch → dehydrate seeds the client cache (per-request query client, spec
// D2); ProductsPricing owns the data from there via useQuery — which is what
// keeps its useOptimistic + router.refresh() reconcile working (the refresh's
// dehydrated payload feeds the same cache).
export default async function ProductsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const queryClient = getQueryClient();
  const [, { data: brandRows }, { data: profile }] = await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["products", "admin"],
      queryFn: () => fetchAdminProducts(supabase),
    }),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
    supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductsPricing brands={(brandRows ?? []) as BrandOption[]} isAdmin={profile?.role === "admin"} />
    </HydrationBoundary>
  );
}
