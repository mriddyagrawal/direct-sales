"use client";

import type { ReactNode } from "react";
import styles from "./BottomSheet.module.css";

interface BottomSheetProps {
  onClose: () => void;
  children: ReactNode;
}

// Flat bottom sheet, 2px ink top-edge — no rounded modal, no shadow (design
// spec S3 resume-draft / S4 keypad). Scrim-tap discards/closes.
export function BottomSheet({ onClose, children }: BottomSheetProps) {
  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
