import { RetailerDetailSkeleton } from "@/components/retailers/RetailerDetailSkeleton";

// Retailer detail (salesman) — no Edit, no Tally ledger row, matching the lens.
// This route has no shared layout, so the skeleton fills the viewport, exactly
// as orders/[id]/loading.tsx does.
export default function Loading() {
  return <RetailerDetailSkeleton role="salesman" />;
}
