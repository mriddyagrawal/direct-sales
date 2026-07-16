import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { ORDER_DETAIL_SELECT, toOrderDetailProps, type OrderDetailQueryRow } from "@/components/orders/order-detail-data";

// Godown lens on the shared OrderDetailView (Stage 2). Same RLS-scoped query as
// every other role; read-only except Mark dispatched on a billed order.
// isAdmin=false. Distinct from /godown/[id] — that's the bespoke scanner; this
// is the reused order detail (where dispatch happens).
export default async function GodownOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "godown") redirect("/");

  const { data } = await supabase.from("orders").select(ORDER_DETAIL_SELECT).eq("id", id).maybeSingle();
  const row = data as unknown as OrderDetailQueryRow | null;
  if (!row) notFound();

  const { order, items, events } = toOrderDetailProps(row);

  return (
    <OrderDetailView
      order={order}
      items={items}
      events={events}
      currentUserId={user.id}
      role="godown"
      isAdmin={false}
    />
  );
}
