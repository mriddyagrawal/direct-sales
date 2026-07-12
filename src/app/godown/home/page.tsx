import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrdersView, type OrderListRow, type BrandOption } from "@/components/orders/OrdersView";
import { GodownTabBar } from "@/components/GodownTabBar";

const GODOWN_ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, admin_comment, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)";

// Godown HOME tab: a browse view of the pipeline the godown works — the same
// shared OrdersView the office uses (role="godown"), with a few less things
// (no salesman/brand filters). The chip-tabs are Pending scan · Ready to bill ·
// Billed · Dispatched (in that order); the first is the default. RLS
// (orders_select_godown) scopes rows to the godown.
const HOME_STATUSES = ["approved", "ready_to_bill", "billed", "dispatched"];

export default async function GodownHomePage() {
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
      .in("status", HOME_STATUSES)
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
        title="Home"
        statusScope={HOME_STATUSES}
        tabs={HOME_STATUSES}
      />
      <GodownTabBar />
    </>
  );
}
