import { createClient } from "@/lib/supabase/server";
import { fetchOrdersList } from "@/lib/queries/orders";
import { OrdersView, type SalesmanOption, type BrandOption } from "@/components/orders/OrdersView";

// Staff lens on the shared OrdersView (unification, 2026-07-10). No role/
// ownership filter on purpose: orders_select_staff (RLS) is what makes
// accountant/admin see every order; the client never re-derives the scope
// RLS already enforces.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Orders query via the shared builder (spec D12) — RLS (orders_select_staff)
  // is still what makes staff see every order; the builder adds no scope filter.
  const [orderRows, { data: salesmenRows }, { data: brandRows }] = await Promise.all([
    fetchOrdersList(supabase, "staff", user!.id),
    supabase.from("profiles").select("id, full_name").eq("role", "salesman").order("full_name"),
    supabase.from("brands").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <OrdersView
      initialOrders={orderRows}
      salesmen={(salesmenRows ?? []) as SalesmanOption[]}
      brands={(brandRows ?? []) as BrandOption[]}
      role="staff"
      currentUserId={user!.id}
    />
  );
}
