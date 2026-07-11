import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrdersView, type OrderListRow, type BrandOption } from "@/components/orders/OrdersView";
import { GodownTabBar } from "@/components/GodownTabBar";

const GODOWN_ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, admin_comment, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)";

// Godown HISTORY tab (Stage 2): a read-only browse of orders past the pick —
// ready to bill, dispatched, or cancelled. Reuses the shared OrdersView
// (role="godown"). RLS (orders_select_godown) scopes rows to the godown.
const HISTORY_STATUSES = ["ready_to_bill", "dispatched", "cancelled"];

export default async function GodownHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "godown") redirect("/");

  const [{ data: orderRows }, { data: brandRows }] = await Promise.all([
    supabase
      .from("orders")
      .select(GODOWN_ORDERS_SELECT)
      .in("status", HISTORY_STATUSES)
      .order("submitted_at", { ascending: false })
      .limit(300),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <>
      <OrdersView
        initialOrders={(orderRows ?? []) as unknown as OrderListRow[]}
        salesmen={[]}
        brands={(brandRows ?? []) as BrandOption[]}
        role="godown"
        currentUserId={user.id}
        title="History"
        statusScope={HISTORY_STATUSES}
      />
      <GodownTabBar />
    </>
  );
}
