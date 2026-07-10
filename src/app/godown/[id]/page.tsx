import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PickScreen } from "./PickScreen";

interface PickOrderRow {
  id: string;
  order_ref: string;
  status: string;
  retailers: { name: string; area: string | null } | null;
  brands: { show_model: boolean; requires_scan: boolean } | null;
  order_items: { id: string; product_name: string; qty: number; position: number; products: { tally_name: string } | null }[];
}

// The pick screen's server shell — gate + fetch. Lines carry product_name and
// qty ONLY (no rate/amount columns are even selected — prices are hidden from
// the godown by owner decision).
export default async function GodownPickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "godown") redirect("/");

  const { data } = await supabase
    .from("orders")
    .select("id, order_ref, status, retailers(name, area), brands(show_model, requires_scan), order_items(id, product_name, qty, position, products(tally_name))")
    .eq("id", id)
    .maybeSingle();

  const order = data as unknown as PickOrderRow | null;
  // Not visible (RLS), or already picked/moved on — back to the queue.
  if (!order || order.status !== "approved") redirect("/godown");

  const lines = [...order.order_items].sort((a, b) => a.position - b.position);

  return (
    <PickScreen
      orderId={order.id}
      orderRef={order.order_ref}
      retailerName={order.retailers?.name ?? "Unknown retailer"}
      retailerArea={order.retailers?.area ?? null}
      showModel={order.brands?.show_model ?? false}
      requiresScan={order.brands?.requires_scan ?? false}
      lines={lines.map((l) => ({ id: l.id, name: l.product_name, qty: l.qty, tally_name: l.products?.tally_name ?? null }))}
    />
  );
}
