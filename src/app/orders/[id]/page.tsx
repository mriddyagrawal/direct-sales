import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { ORDER_DETAIL_SELECT, toOrderDetailProps, type OrderDetailQueryRow } from "@/components/orders/order-detail-data";

// Salesman lens on the shared OrderDetailView (unification, 2026-07-10).
// Identical query to the staff workbench — RLS scopes it to his own orders
// (anyone else's id → no row → 404) and returns zero order_item_scans rows
// (that table is staff/godown-only), so nothing here needs a role check
// beyond passing role="salesman". No catalog: his edits go through the
// Quick Order flow, not the inline editor.
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase.from("orders").select(ORDER_DETAIL_SELECT).eq("id", id).maybeSingle();

  const row = data as unknown as OrderDetailQueryRow | null;
  if (!row) notFound();

  const { order, items, events } = toOrderDetailProps(row);

  return (
    <OrderDetailView
      order={order}
      items={items}
      events={events}
      catalog={[]}
      currentUserId={user!.id}
      role="salesman"
      isAdmin={false}
    />
  );
}
