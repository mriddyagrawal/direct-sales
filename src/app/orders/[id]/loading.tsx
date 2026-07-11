import { OrderDetailSkeleton } from "@/components/OrderDetailSkeleton";

// Order detail (salesman) — full-page fallback; this route has no shared
// layout, so the skeleton fills the viewport.
export default function Loading() {
  return <OrderDetailSkeleton />;
}
