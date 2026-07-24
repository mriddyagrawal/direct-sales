import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { fetchOrdersList } from "@/lib/queries/orders";
import { OrdersView, type BrandOption } from "@/components/orders/OrdersView";
import { GodownTabBar } from "@/components/GodownTabBar";

// Godown DISPATCH tab (Stage 2): billed orders awaiting a physical ship-out.
// Reuses the shared OrdersView (role="godown"); Mark dispatched lives on the
// reused detail at /godown/orders/[id]. RLS (orders_select_godown) scopes rows.
export default async function GodownDispatchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "godown") redirect("/");

  // Same column set as the dashboard/home OrdersView selects — the godown may
  // see prices/amounts (owner: "don't go the extra mile hiding them"). Query
  // via the shared builder (spec D12); prefetch → dehydrate seeds the client
  // cache (per-request query client, spec D2).
  const queryClient = getQueryClient();
  const [, { data: brandRows }] = await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["orders", "godown-dispatch"],
      queryFn: () => fetchOrdersList(supabase, "godown-dispatch", user.id),
    }),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <OrdersView
          scope="godown-dispatch"
          salesmen={[]}
          brands={(brandRows ?? []) as BrandOption[]}
          role="godown"
          currentUserId={user.id}
          title="Dispatch"
          statusScope={["billed"]}
        />
      </HydrationBoundary>
      <GodownTabBar />
    </>
  );
}
