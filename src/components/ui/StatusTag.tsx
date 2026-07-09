import styles from "./StatusTag.module.css";

export type StatusTone = "accent" | "amber" | "locked" | "billed" | "error";

interface StatusTagProps {
  tone: StatusTone;
  label: string;
}

// Flat rectangular tag + leading 8px status square + mono text — never a
// pastel pill (design spec §1/§2 "Status system"). Chip = status: this
// component only renders what it's told: the derived lock governs edit
// *permission* elsewhere, never which chip shows.
export function StatusTag({ tone, label }: StatusTagProps) {
  return (
    <span className={[styles.tag, styles[tone]].join(" ")}>
      <span className={styles.square} aria-hidden />
      {label}
    </span>
  );
}
