"use client";

import { useEffect, useState } from "react";
import styles from "./ShareOrderButton.module.css";

interface ShareOrderButtonProps {
  title: string;
  text: string;
  // Optional style override so the pick slip can reuse its Print-button look;
  // the salesman page uses the default outline style.
  className?: string;
}

// Mobile Web Share (WhatsApp etc.) of an order as plain text, with a desktop
// Copy fallback. `navigator.share` is feature-detected AFTER mount so SSR and
// first client render agree (no hydration mismatch) — the label starts "Copy"
// and flips to "Share" on a device that supports it. A cancelled share sheet
// throws AbortError, which we swallow.
export function ShareOrderButton({ title, text, className }: ShareOrderButtonProps) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  async function handleClick() {
    if (canShare) {
      try {
        await navigator.share({ title, text });
      } catch {
        // AbortError (user dismissed the sheet) or an unsupported target — ignore quietly.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permission) — nothing to do.
    }
  }

  return (
    <button type="button" className={className ?? styles.button} onClick={handleClick}>
      {canShare ? "Share order" : copied ? "Copied ✓" : "Copy order"}
    </button>
  );
}
