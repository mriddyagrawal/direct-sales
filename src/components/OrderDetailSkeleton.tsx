import { Skeleton } from "@/components/ui/Skeleton";

// Shape-matched fallback for the shared OrderDetailView (used by both
// /orders/[id] and /dashboard/orders/[id]). Presentation-only, renders
// instantly. Layout is inline — a throwaway skeleton earns no CSS module.
export function OrderDetailSkeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 720, margin: "0 auto", width: "100%" }} aria-hidden>
      {/* Back eyebrow */}
      <Skeleton width={96} height={14} />

      {/* Ref + retailer hero */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton width={140} height={22} />
        <Skeleton width={220} height={28} />
        <Skeleton width={160} height={14} />
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>

      {/* Items table: header + 4 line rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        <Skeleton width="100%" height={12} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <Skeleton width="46%" height={16} />
            <Skeleton width={44} height={16} />
            <Skeleton width={64} height={16} />
            <Skeleton width={72} height={16} />
          </div>
        ))}
      </div>

      {/* Total bar */}
      <Skeleton width="100%" height={20} />

      {/* History */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <Skeleton width={72} height={12} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={`${70 - i * 12}%`} height={14} />
        ))}
      </div>
    </div>
  );
}
