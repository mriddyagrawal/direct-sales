"use client";

import styles from "./Stepper.module.css";

interface StepperProps {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
  onTapQuantity: () => void;
  // "sm" shrinks the control for dense rows (e.g. the review cart); default
  // "md" keeps the ≥48px hit area used everywhere else.
  size?: "md" | "sm";
}

// [-] qty [+] — the + is the most-tapped control in the app (design spec
// §"Layout"): ≥48px hit area even where the visual cell is smaller. Tapping
// the qty number opens the keypad sheet instead of incrementing (typing 24
// beats tapping + 24 times).
export function Stepper({ qty, max, onChange, onTapQuantity, size = "md" }: StepperProps) {
  return (
    <div className={`${styles.stepper} ${size === "sm" ? styles.sm : ""}`}>
      <button
        type="button"
        className={`${styles.button} ${styles.buttonMinus}`}
        onClick={() => onChange(Math.max(0, qty - 1))}
        disabled={qty <= 0}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <button type="button" className={styles.qty} onClick={onTapQuantity} aria-label="Set quantity">
        {qty}
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.buttonPlus} ${qty > 0 ? styles.buttonPlusActive : ""}`}
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
