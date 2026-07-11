import { Skeleton } from "@/components/ui/Skeleton";

// Godown pickup queue — brand header, "To pick" heading, then ~5 order-card
// skeletons. Full-page fallback (godown has its own shell, no shared layout).
export default function Loading() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }} aria-hidden>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 16,
          borderBottom: "1px solid var(--color-hairline)",
        }}
      >
        <Skeleton width={160} height={16} />
        <Skeleton width={80} height={14} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 16px 8px" }}>
        <Skeleton width={90} height={24} />
        <Skeleton width={28} height={24} />
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={72} />
        ))}
      </div>
    </div>
  );
}
