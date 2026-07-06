"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import styles from "./KeypadSheet.module.css";

interface KeypadSheetProps {
  productName: string;
  currentQty: number;
  max: number;
  onCancel: () => void;
  onSet: (qty: number) => void;
}

// Own numeric keypad, no OS keyboard (design spec S4): 3 digits max, keys
// 54px. The UI cap is 999 — deliberately stricter than the DB's 1..9999
// bound; a fail-safe, not a bug (§1 hard constraints — don't "fix" it).
export function KeypadSheet({ productName, currentQty, max, onCancel, onSet }: KeypadSheetProps) {
  const [digits, setDigits] = useState("");

  function press(d: string) {
    const next = (digits + d).slice(0, 3);
    if (Number(next) > max) return;
    setDigits(next);
  }

  function backspace() {
    setDigits((d) => d.slice(0, -1));
  }

  function confirm() {
    const qty = digits === "" ? 0 : Number(digits);
    onSet(Math.min(max, qty));
  }

  return (
    <BottomSheet onClose={onCancel}>
      <div className={styles.header}>
        <span className={styles.productName}>{productName}</span>
        <span className={styles.currentQty}>{digits || currentQty}</span>
      </div>
      <div className={styles.grid}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className={styles.key} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={styles.key} onClick={backspace} aria-label="Backspace">
          ⌫
        </button>
        <button type="button" className={styles.key} onClick={() => press("0")}>
          0
        </button>
        <span />
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={confirm}>
          Set quantity
        </Button>
      </div>
    </BottomSheet>
  );
}
