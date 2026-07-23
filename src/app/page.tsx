import { createClient } from "@/lib/supabase/server";
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
  const [orderRows, { data: brandRows }] = await Promise.all([
    fetchOrdersList(supabase, "salesman", user!.id),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user?.email ?? ""} />
      <div className={styles.content}>
        <OrdersView
          initialOrders={orderRows}
          salesmen={[]}
          brands={(brandRows ?? []) as BrandOption[]}
          role="salesman"
          currentUserId={user!.id}
        />
      </div>

      <BottomTabBar />
    </div>
  );
}
