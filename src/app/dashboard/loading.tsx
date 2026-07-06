import styles from "./dashboard-loading.module.css";

// Skeleton, never a spinner (design spec S8) — takes over the dashboard's
// own Suspense boundary, more specific than the root card skeleton.
export default function DashboardLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.chrome} />
      <div className={styles.content}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.row} />
        ))}
      </div>
    </div>
  );
}
