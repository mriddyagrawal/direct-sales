import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { fetchRetailers } from "@/lib/queries/retailers";
import { TopStrip } from "@/components/TopStrip";
import { BottomTabBar } from "@/components/BottomTabBar";
import { RetailersBrowse } from "./RetailersBrowse";
import shell from "@/components/ui/tab-shell.module.css";

// The salesman's Retailers tab (owner 2026-08-01) — a shop list he can pull up
// mid-conversation, with the balance on every row. Mirrors /products: auth
// check, prefetch → dehydrate, TopStrip above, BottomTabBar below.
//
// A TAB HOME, so NO back arrow — same as /products and / (neither renders a
// BackLink). This is a destination, not a step in a flow; the picker keeps its
// back because leaving the new-order flow is what that back MEANS.
//
// THE LIST IS EVERY ACTIVE SHOP, not "his" shops, and that is not a shortcut:
// there is no per-salesman ownership of retailers in the database at all
// (retailers_select_salesman is `active`-only, with no salesman predicate).
// A "my shops" list would be a fiction assembled from order history, and it
// would hide the shops he has never billed — exactly the ones he might be
// walking into. RLS is what scopes the rows; this page adds no filter.
//
// No new query and no new privilege: the ["retailers"] key is the same one the
// Quick Order picker already prefetches, so the two share a cache, and
// RETAILER_SELECT already fetched every column this needs.
export default async function RetailersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const queryClient = getQueryClient();
  const [, { data: profile }, { data: recentRows }] = await Promise.all([
    queryClient.prefetchQuery({ queryKey: ["retailers"], queryFn: () => fetchRetailers(supabase) }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    // RECENT = the shops he has ordered from lately — the same derivation
    // new-order/page.tsx uses for the picker, so both lists lead with the same
    // shops. RLS scopes these rows to his own orders.
    supabase.from("orders").select("retailer_id, submitted_at").order("submitted_at", { ascending: false }).limit(30),
  ]);

  const seen = new Set<string>();
  const recentRetailerIds: string[] = [];
  for (const row of (recentRows ?? []) as { retailer_id: string }[]) {
    if (!seen.has(row.retailer_id)) {
      seen.add(row.retailer_id);
      recentRetailerIds.push(row.retailer_id);
    }
    if (recentRetailerIds.length >= 8) break;
  }

  return (
    <div className={shell.page}>
      <TopStrip accountLabel={profile?.full_name ?? user.email ?? ""} />
      <div className={shell.content}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <RetailersBrowse recentRetailerIds={recentRetailerIds} />
        </HydrationBoundary>
      </div>
      <BottomTabBar />
    </div>
  );
}
