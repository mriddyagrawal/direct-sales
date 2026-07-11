import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
}

// Presentation-only pulsing placeholder for route `loading.tsx` fallbacks —
// mirrors the shimmer of the original app/loading.tsx (design spec S2/S8:
// skeletons, never spinners). No data, no async: renders instantly as the
// Suspense fallback while the server renders the real page.
export function Skeleton({ width = "100%", height = 16, radius = "var(--radius)", className }: SkeletonProps) {
  return (
    <div
      className={className ? `${styles.skeleton} ${className}` : styles.skeleton}
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}
