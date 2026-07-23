import { Skeleton } from "@/components/ui/Skeleton";
import styles from "./products.module.css";

// Skeleton, never a spinner (design spec S2/S8) — the only salesman route that
// shipped without one (owner felt the dead tap, 2026-07-24). Mirrors the
// Products browse: search bar band, a brand header, then two-line rows.
export default function Loading() {
  return (
    <div className={styles.page}>
      <div className={styles.content} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Skeleton width="38%" height={44} />
          <Skeleton height={44} />
        </div>
        <Skeleton width={140} height={12} />
        <Skeleton height={36} />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton width={`${55 + ((i * 13) % 30)}%`} height={14} />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Skeleton width={48} height={12} />
              <Skeleton width={90} height={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
