import styles from "./FlowHeader.module.css";

interface FlowHeaderProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
}

// Shared "back arrow + title (+ optional subtitle)" header across S3/S4/S5
// (design spec §3). No step language anywhere — the header's job is just
// navigation (the bottom tab bar hides during the order-taking flow) and,
// on S4, confirming which shop the order is for.
export function FlowHeader({ title, subtitle, onBack }: FlowHeaderProps) {
  return (
    <div className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
        ←
      </button>
      <div className={styles.titles}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
    </div>
  );
}
