import { createClient } from "@/lib/supabase/server";
import {
  OrdersView,
  type OrderListRow,
  type SalesmanOption,
  type BrandOption,
} from "@/components/orders/OrdersView";

// Staff lens on the shared OrdersView (unification, 2026-07-10). No role/
// ownership filter on purpose: orders_select_staff (RLS) is what makes
// accountant/admin see every order; the client never re-derives the scope
// RLS already enforces.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: orderRows }, { data: salesmenRows }, { data: brandRows }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)",
      )
      .order("submitted_at", { ascending: false })
      .limit(300),
    supabase.from("profiles").select("id, full_name").eq("role", "salesman").order("full_name"),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <OrdersView
      initialOrders={(orderRows ?? []) as unknown as OrderListRow[]}
      salesmen={(salesmenRows ?? []) as SalesmanOption[]}
      brands={(brandRows ?? []) as BrandOption[]}
      role="staff"
      currentUserId={user!.id}
    />
  );
}
