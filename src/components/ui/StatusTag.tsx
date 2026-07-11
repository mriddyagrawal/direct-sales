import styles from "./StatusTag.module.css";

export type StatusTone = "accent" | "amber" | "locked" | "billed" | "error" | "backorder" | "dispatched";

interface StatusTagProps {
  tone: StatusTone;
  label: string;
  // Second, smaller line under the label ("editable 1h 59m", "waiting for
  // scan") — keeps the chip narrow instead of one long · joined string
  // (owner request: the wide chip was wrapping the order ref).
  sublabel?: string;
}

// Flat rectangular tag + leading 8px status square + mono text — never a
// pastel pill (design spec §1/§2 "Status system"). Chip = status: this
// component only renders what it's told: the derived lock governs edit
// *permission* elsewhere, never which chip shows.
export function StatusTag({ tone, label, sublabel }: StatusTagProps) {
  return (
    <span className={[styles.tag, styles[tone]].join(" ")}>
      <span className={styles.square} aria-hidden />
      {sublabel ? (
        <span className={styles.lines}>
          {label}
          <span className={styles.sublabel}>{sublabel}</span>
        </span>
      ) : (
        label
      )}
    </span>
  );
}
