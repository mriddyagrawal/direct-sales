import { RetailerDetailSkeleton } from "@/components/retailers/RetailerDetailSkeleton";

// Retailer detail (staff) — the office lens, so the skeleton draws the Tally
// ledger row and the Edit placeholder. Shape and reasoning live in the shared
// skeleton; this file exists because the boundary must sit on the ROUTE.
export default function Loading() {
  return <RetailerDetailSkeleton role="staff" />;
}
