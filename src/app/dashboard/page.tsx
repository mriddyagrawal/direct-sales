import { createClient } from "@/lib/supabase/server";
import { OrdersList } from "./OrdersList";

export interface DashboardOrderRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  total_paise: number;
  status: string;
  editable_until: string;
  cancelled_by: string | null;
  salesman_id: string;
  retailers: { name: string; verified: boolean } | null;
  profiles: { full_name: string } | null;
  order_items: { count: number }[];
}

export interface SalesmanOption {
  id: string;
  full_name: string;
}

// S8 — orders list. No role/ownership filter on purpose: orders_select_staff
// (RLS) is what makes accountant/admin see every order; the client never
// re-derives the scope RLS already enforces.
export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: orderRows }, { data: salesmenRows }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, salesman_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), order_items(count)",
      )
      .order("submitted_at", { ascending: false })
      .limit(300),
    supabase.from("profiles").select("id, full_name").eq("role", "salesman").order("full_name"),
  ]);

  const orders = (orderRows ?? []) as unknown as DashboardOrderRow[];
  const salesmen = (salesmenRows ?? []) as SalesmanOption[];

  return <OrdersList initialOrders={orders} salesmen={salesmen} />;
}
