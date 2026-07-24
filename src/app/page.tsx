import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { fetchOrdersList } from "@/lib/queries/orders";
import { BottomTabBar } from "@/components/BottomTabBar";
import { TopStrip } from "@/components/TopStrip";
import { OrdersView, type BrandOption } from "@/components/orders/OrdersView";
import styles from "./page.module.css";

// Salesman home — the same shared OrdersView the staff dashboard renders
// (unification, 2026-07-10), wrapped in the phone shell (bottom tab bar +
// account strip). Same select as the dashboard; RLS scopes it to his own
// orders. He gains status tabs, search, date-range, and Realtime for free.
//
// D8 (decisions.md): a *self*-cancelled order is hidden — it almost always
// corrects a mistake and should read as "never happened." An office-cancelled
// order stays visible (real news, not noise). `status.neq.cancelled` alone
// covers every non-cancelled order; the second clause only decides which
// *cancelled* orders survive. OrdersView applies the same rule to Realtime
// events so a self-cancel can't sneak back in live.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  // brands feed the card/table brand label only — the BRAND filter itself is
  // staff-gated inside OrdersView. The orders query (incl. the D8 self-cancel
  // clause) lives in the shared builder — spec D12, never inline it here.
  //
  // getQueryClient() is per-request on the server (spec D2's security rule);
  // the prefetch seeds ["orders", scope] and dehydrate() hands it to the
  // browser cache below — the client's first paint IS this payload, and the
  // same builder serves its background refetches. prefetchQuery swallows a DB
  // error (page still renders; the client queryFn retries within ~1s), which
  // matches the old silent-empty behavior but self-heals.
  const queryClient = getQueryClient();
  const [, { data: brandRows }] = await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["orders", "salesman"],
      queryFn: () => fetchOrdersList(supabase, "salesman", user!.id),
    }),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user?.email ?? ""} />
      <div className={styles.content}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <OrdersView
            scope="salesman"
            salesmen={[]}
            brands={(brandRows ?? []) as BrandOption[]}
            role="salesman"
            currentUserId={user!.id}
          />
        </HydrationBoundary>
      </div>

      <BottomTabBar />
    </div>
  );
}
