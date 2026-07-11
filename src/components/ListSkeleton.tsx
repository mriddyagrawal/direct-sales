import { Skeleton } from "@/components/ui/Skeleton";
import styles from "./ListSkeleton.module.css";

// Shared table/list fallback for the dashboard list pages (products, retailers,
// users). Renders inside the persistent dashboard shell, so it only fills the
// content area — a title line + N row skeletons, with the same 16/24 responsive
// padding the real content uses (so the swap doesn't jump).
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className={styles.content} aria-hidden>
      <Skeleton width={160} height={24} />
      <div className={styles.rows}>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} width="100%" height={44} />
        ))}
      </div>
    </div>
  );
}
