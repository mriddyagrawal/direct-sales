import { createClient } from "@/lib/supabase/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { fetchRetailers, type RetailerRow } from "@/lib/queries/retailers";
import { RetailersQueue } from "./RetailersQueue";

// The row shape + query live in the shared superset builder (spec D12/D4b) —
// the same ["retailers"] cache also feeds the Quick Order picker. Re-exported
// so existing importers keep working.
export type { RetailerRow };

// S11 — retailer verification queue. accountant/admin have RLS ALL on
// retailers (roles-and-permissions.md), so edits go through a direct
// RLS-scoped update, not an RPC — retailers aren't in the RPC-only
// category that orders/order_items/order_events are. Prefetch → dehydrate
// seeds the client cache (per-request query client, spec D2).
export default async function RetailersPage() {
  const supabase = await createClient();
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["retailers"],
    queryFn: () => fetchRetailers(supabase),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RetailersQueue />
    </HydrationBoundary>
  );
}
