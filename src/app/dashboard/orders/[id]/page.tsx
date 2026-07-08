import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderWorkbench } from "./OrderWorkbench";

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  price_paise: number | null;
  active: boolean;
}

interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_paise: number;
  qty: number;
  line_total_paise: number;
  position: number;
}

interface EventRow {
  id: number;
  action: string;
  actor_id: string | null;
  details: unknown;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface WorkbenchOrderRow {
  id: string;
  order_ref: string;
  status: string;
  notes: string;
  total_paise: number;
  submitted_at: string;
  editable_until: string;
  processed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  salesman_id: string;
  retailers: { name: string; area: string | null; phone: string | null; verified: boolean } | null;
  approved_at: string | null;
  approved_by: string | null;
  salesman: { full_name: string } | null;
  processed_by_profile: { full_name: string } | null;
  cancelled_by_profile: { full_name: string } | null;
  approved_by_profile: { full_name: string } | null;
  brands: { name: string; code: string } | null;
  order_items: OrderItemRow[];
  order_events: EventRow[];
}

export default async function WorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data }, { data: productRows }, { data: profile }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_ref, status, notes, total_paise, submitted_at, editable_until, processed_at, cancelled_at, cancelled_by, approved_at, approved_by, salesman_id, " +
          "retailers(name, area, phone, verified), " +
          "salesman:profiles!orders_salesman_id_fkey(full_name), " +
          "processed_by_profile:profiles!orders_processed_by_fkey(full_name), " +
          "cancelled_by_profile:profiles!orders_cancelled_by_fkey(full_name), " +
          "approved_by_profile:profiles!orders_approved_by_fkey(full_name), " +
          "brands(name, code), " +
          "order_items(id, product_id, product_name, unit_price_paise, qty, line_total_paise, position), " +
          "order_events(id, action, actor_id, details, created_at, profiles!order_events_actor_id_fkey(full_name))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("products").select("id, name, category, price_paise, active").order("category").order("name"),
    supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  const order = data as unknown as WorkbenchOrderRow | null;
  if (!order) notFound();

  const items = [...order.order_items].sort((a, b) => a.position - b.position);
  const events = [...order.order_events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const catalog = (productRows ?? []) as CatalogProduct[];

  return (
    <OrderWorkbench
      order={{
        id: order.id,
        orderRef: order.order_ref,
        status: order.status,
        notes: order.notes,
        totalPaise: order.total_paise,
        submittedAt: order.submitted_at,
        editableUntil: order.editable_until,
        processedAt: order.processed_at,
        cancelledAt: order.cancelled_at,
        cancelledByName: order.cancelled_by_profile?.full_name ?? null,
        salesmanName: order.salesman?.full_name ?? "Unknown",
        processedByName: order.processed_by_profile?.full_name ?? null,
        retailerName: order.retailers?.name ?? "Unknown retailer",
        retailerArea: order.retailers?.area ?? null,
        retailerPhone: order.retailers?.phone ?? null,
        retailerVerified: order.retailers?.verified ?? true,
        brandName: order.brands?.name ?? null,
        approvedAt: order.approved_at,
        approvedByName: order.approved_by_profile?.full_name ?? null,
      }}
      items={items}
      events={events}
      catalog={catalog}
      currentUserId={user!.id}
      isAdmin={profile?.role === "admin"}
    />
  );
}
