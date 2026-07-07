import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PickSlip } from "./PickSlip";

interface PickSlipItemRow {
  product_name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  position: number;
}

interface PickSlipOrderRow {
  order_ref: string;
  submitted_at: string;
  notes: string;
  total_paise: number;
  retailers: { name: string; area: string | null; phone: string | null } | null;
  salesman: { full_name: string } | null;
  order_items: PickSlipItemRow[];
}

export default async function PickSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("orders")
    .select(
      "order_ref, submitted_at, notes, total_paise, retailers(name, area, phone), salesman:profiles!orders_salesman_id_fkey(full_name), order_items(product_name, qty, unit_price_paise, line_total_paise, position)",
    )
    .eq("id", id)
    .maybeSingle();

  const order = data as unknown as PickSlipOrderRow | null;
  if (!order) notFound();

  const items = [...order.order_items].sort((a, b) => a.position - b.position);

  return (
    <PickSlip
      orderRef={order.order_ref}
      submittedAt={order.submitted_at}
      notes={order.notes}
      totalPaise={order.total_paise}
      retailerName={order.retailers?.name ?? "Unknown retailer"}
      retailerArea={order.retailers?.area ?? null}
      retailerPhone={order.retailers?.phone ?? null}
      salesmanName={order.salesman?.full_name ?? "Unknown"}
      items={items}
    />
  );
}
