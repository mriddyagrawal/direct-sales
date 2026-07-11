import { Skeleton } from "@/components/ui/Skeleton";

// Quick Order — a slim flow header, a search bar, then ~6 product-row
// skeletons. Full-page fallback (no shared layout on this route).
export default function Loading() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }} aria-hidden>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 16,
          borderBottom: "1px solid var(--color-hairline)",
        }}
      >
        <Skeleton width={24} height={24} />
        <Skeleton width={140} height={20} />
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton width="100%" height={44} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={56} />
        ))}
      </div>
    </div>
  );
}
