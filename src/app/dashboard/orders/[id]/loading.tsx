import { OrderDetailSkeleton } from "@/components/OrderDetailSkeleton";

// Order detail (staff) — same shared OrderDetailView shape; renders inside the
// dashboard shell.
export default function Loading() {
  return <OrderDetailSkeleton />;
}
