import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PickScreen } from "@/app/godown/[id]/PickScreen";

interface ScanOrderRow {
  id: string;
  order_ref: string;
  status: string;
  retailers: { name: string; area: string | null } | null;
  brands: { show_model: boolean; requires_scan: boolean } | null;
  order_items: { id: string; product_name: string; qty: number; position: number; products: { tally_name: string } | null }[];
}

// Universal scan screen — any authenticated, ACTIVE role may scan an approved
// LG order's serials (admin / accountant / salesman). No godown gate: the
// middleware already enforces auth+active and fences godown to /godown; RLS
// scopes this fetch (a salesman sees only his own orders → a foreign id yields
// no row → redirect). Same PRICE-FREE columns the godown page selects — prices
// never reach the scanner. submit_pick is the server-side gatekeeper (it adds
// the salesman-own scope). doneHref sends the caller back to the order detail.
export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
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
  // Salesman order detail lives at /orders/[id]; staff at /dashboard/orders/[id].
  const detailBase = profile?.role === "salesman" ? "/orders" : "/dashboard/orders";
  const detailHref = `${detailBase}/${id}`;

  const { data } = await supabase
    .from("orders")
    .select("id, order_ref, status, retailers(name, area), brands(show_model, requires_scan), order_items(id, product_name, qty, position, products(tally_name))")
    .eq("id", id)
    .maybeSingle();

  const order = data as unknown as ScanOrderRow | null;
  // Not visible (RLS), or no longer awaiting a pick — back to the order detail.
  if (!order || order.status !== "approved") redirect(detailHref);

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
      doneHref={detailHref}
    />
  );
}
