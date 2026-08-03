import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetailerDetail } from "@/components/retailers/RetailerDetail";
import { RETAILER_SELECT, type RetailerRow } from "@/lib/queries/retailers";
import { fetchRetailerLedger, ledgerSinceDate, LEDGER_SINCE_DEFAULT } from "@/lib/queries/ledger";
import { getQueryClient } from "@/lib/query-client";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

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

  // THE LEDGER IS FETCHED ONLY AFTER THAT 404, and the order is load-bearing:
  // `ledger_entries_select_all` is `auth_profile_role() IS NOT NULL`, so the
  // ledger table scopes NOTHING — every signed-in role can read every entry for
  // every shop. The retailer row is the boundary, so a shop this caller cannot
  // see must stop the request before a single entry is read.
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["ledger", id, LEDGER_SINCE_DEFAULT],
    queryFn: () => fetchRetailerLedger(supabase, id, ledgerSinceDate(LEDGER_SINCE_DEFAULT)),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RetailerDetail retailer={data as RetailerRow} role="salesman" />
    </HydrationBoundary>
  );
}
