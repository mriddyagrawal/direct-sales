"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchRetailers } from "@/lib/queries/retailers";
import { RetailerList } from "@/components/retailers/RetailerList";
import styles from "./RetailersBrowse.module.css";

// The salesman's Retailers tab — read-only, and the same RetailerList the Quick
// Order picker uses. The ONLY difference is the tap: an href here, so a row
// navigates to the shop, versus the picker's onSelect, which advances a flow.
//
// No quick-add and therefore no FAB (spec decision 7): adding a shop is part of
// taking an order from it, and a shop added while browsing has no order to
// attach to. Read-only, exactly like /products.
//
// Spec D10/D13: render ONLY from the query cache — seeded by the page's
// HydrationBoundary, corrected on mount/focus/reconnect. `?? []` keeps a
// painted list painted if a background refetch fails. This is the same
// ["retailers"] key the picker already prefetches, so the two share a cache.
export function RetailersBrowse({ recentRetailerIds }: { recentRetailerIds: string[] }) {
  const { data: retailers = [] } = useQuery({
    queryKey: ["retailers"],
    queryFn: () => fetchRetailers(createClient()),
  });

  return (
    <div className={styles.page}>
      <RetailerList
        retailers={retailers}
        recentRetailerIds={recentRetailerIds}
        href={(r) => `/retailers/${r.id}`}
      />
    </div>
  );
}
