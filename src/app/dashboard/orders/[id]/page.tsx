import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { ORDER_DETAIL_SELECT, toOrderDetailProps, type OrderDetailQueryRow } from "@/components/orders/order-detail-data";

// Staff lens on the shared OrderDetailView (unification, 2026-07-10): same
// component and same RLS-scoped query as the salesman's /orders/[id]. This page
// additionally fetches the caller's role (Approve is admin-only). Editing now
// routes to the Quick Order flow (/new-order?edit=…) — no catalog fetch here.
export default async function WorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data }, { data: profile }] = await Promise.all([
    supabase.from("orders").select(ORDER_DETAIL_SELECT).eq("id", id).maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  const row = data as unknown as OrderDetailQueryRow | null;
  if (!row) notFound();

  const { order, items, events } = toOrderDetailProps(row);

  return (
    <OrderDetailView
      order={order}
      items={items}
      events={events}
      currentUserId={user!.id}
      role="staff"
      isAdmin={profile?.role === "admin"}
    />
  );
}
