import { Skeleton } from "@/components/ui/Skeleton";

// Godown deposits — title, hero band, then day-grouped row skeletons
// (mirrors the salesman deposits skeleton inside the godown shell).
export default function Loading() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }} aria-hidden>
      <Skeleton width={120} height={26} />
      <Skeleton width="100%" height={64} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton width={90} height={14} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={56} />
        ))}
      </div>
    </div>
  );
}
