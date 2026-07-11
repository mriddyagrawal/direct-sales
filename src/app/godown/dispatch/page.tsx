import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrdersView, type OrderListRow, type BrandOption } from "@/components/orders/OrdersView";
import { GodownTabBar } from "@/components/GodownTabBar";

// Same column set as the dashboard/home OrdersView selects — the godown may see
// prices/amounts (owner: "don't go the extra mile hiding them").
const GODOWN_ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, admin_comment, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)";

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

  const [{ data: orderRows }, { data: brandRows }] = await Promise.all([
    supabase
      .from("orders")
      .select(GODOWN_ORDERS_SELECT)
      .eq("status", "billed")
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
        title="Dispatch"
        statusScope={["billed"]}
      />
      <GodownTabBar />
    </>
  );
}
