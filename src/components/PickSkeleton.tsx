import { Skeleton } from "@/components/ui/Skeleton";

// Shape-matched fallback for the godown pick / universal-scan screens (used by
// both /godown/[id] and /scan/[id]): slim header, one large capture block
// (camera area), then a couple of line rows. Presentation-only.
export function PickSkeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 720, margin: "0 auto", width: "100%" }} aria-hidden>
      {/* Header: back + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Skeleton width={24} height={24} />
        <Skeleton width={180} height={20} />
      </div>

      {/* Large capture / camera block */}
      <Skeleton width="100%" height={240} />

      {/* Line rows */}
      {[0, 1].map((i) => (
        <Skeleton key={i} width="100%" height={56} />
      ))}
    </div>
  );
}
