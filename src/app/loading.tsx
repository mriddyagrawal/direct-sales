import styles from "./loading.module.css";

// Skeleton, never a spinner (design spec S2/S8 "loading skeleton").
export default function Loading() {
  return (
    <div className={styles.page}>
      {[1, 2, 3].map((i) => (
        <div key={i} className={styles.card} />
      ))}
    </div>
  );
}
