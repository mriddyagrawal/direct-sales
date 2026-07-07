import styles from "./FlowHeader.module.css";

interface FlowHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
}

// Shared "back arrow + title + STEP n/3" header across S3/S4/S5 (design spec
// §3). The bottom tab bar hides during the order-taking flow — this header
// is the navigation instead.
export function FlowHeader({ title, subtitle, onBack }: FlowHeaderProps) {
  return (
    <div className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
        ←
      </button>
      <div className={styles.titles}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </div>
    </div>
  );
}
