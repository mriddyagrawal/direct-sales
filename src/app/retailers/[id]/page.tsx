import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetailerDetail } from "@/components/retailers/RetailerDetail";
import { RETAILER_SELECT, type RetailerRow } from "@/lib/queries/retailers";

// Salesman lens on the shared RetailerDetail (spec retailer-detail-salesman-lens,
// step 2) — the mirror of orders/[id]/page.tsx. Identical query to the office
// route; the ONLY differences are the shell (no dashboard/layout.tsx here) and
// the role prop, which hides Edit and the Tally ledger row.
//
// THE URL IS NOT THE SECURITY BOUNDARY — RLS is, and there is deliberately no
// role check written here. retailers_select_salesman is `active` only, so a
// deactivated shop, like any id he has no business reading, returns no row and
// maybeSingle() -> notFound() 404s it. Writing a guard here would imply the
// route is what protects the data; it is not.
export default async function RetailerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("retailers").select(RETAILER_SELECT).eq("id", id).maybeSingle();

  if (!data) notFound();

  return <RetailerDetail retailer={data as RetailerRow} role="salesman" />;
}
