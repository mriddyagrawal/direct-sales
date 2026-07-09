import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderDetailView, type CatalogProduct } from "@/components/orders/OrderDetailView";
import { ORDER_DETAIL_SELECT, toOrderDetailProps, type OrderDetailQueryRow } from "@/components/orders/order-detail-data";

// Staff lens on the shared OrderDetailView (unification, 2026-07-10): same
// component and same RLS-scoped query as the salesman's /orders/[id] — this
// page additionally fetches the catalog (for the inline editor) and the
// caller's role (Approve is admin-only).
export default async function WorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data }, { data: productRows }, { data: profile }] = await Promise.all([
    supabase.from("orders").select(ORDER_DETAIL_SELECT).eq("id", id).maybeSingle(),
    supabase.from("products").select("id, name, category, price_paise, active").order("category").order("name"),
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
      catalog={(productRows ?? []) as CatalogProduct[]}
      currentUserId={user!.id}
      role="staff"
      isAdmin={profile?.role === "admin"}
    />
  );
}
