import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { fetchOrdersList, GODOWN_HOME_STATUSES } from "@/lib/queries/orders";
import { OrdersView, type BrandOption } from "@/components/orders/OrdersView";
import { GodownTabBar } from "@/components/GodownTabBar";

// Godown HOME tab: a browse view of the pipeline the godown works — the same
// shared OrdersView the office uses (role="godown"), with a few less things
// (no salesman/brand filters). The chip-tabs are Pending scan · Ready to bill ·
// Billed · Dispatched (in that order); the first is the default. RLS
// (orders_select_godown) scopes rows to the godown. The query + status set
// live in the shared builder (spec D12).

export default async function GodownHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "godown") redirect("/");

  // Prefetch → dehydrate seeds the client cache (per-request query client,
  // spec D2); OrdersView owns the data from there via useQuery.
  const queryClient = getQueryClient();
  const [, { data: brandRows }] = await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["orders", "godown-home"],
      queryFn: () => fetchOrdersList(supabase, "godown-home", user.id),
    }),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <OrdersView
          scope="godown-home"
          salesmen={[]}
          brands={(brandRows ?? []) as BrandOption[]}
          role="godown"
          currentUserId={user.id}
          title="Home"
          statusScope={GODOWN_HOME_STATUSES}
          tabs={GODOWN_HOME_STATUSES}
        />
      </HydrationBoundary>
      <GodownTabBar />
    </>
  );
}
