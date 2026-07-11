import { Skeleton } from "@/components/ui/Skeleton";

// Deposits — a static "Coming soon" page; a minimal centered placeholder is
// all this needs (it renders near-instantly).
export default function Loading() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
      }}
      aria-hidden
    >
      <Skeleton width={160} height={24} />
      <Skeleton width={240} height={14} />
    </div>
  );
}
