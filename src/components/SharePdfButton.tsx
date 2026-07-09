"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";

interface SharePdfButtonProps {
  orderId: string;
  orderRef: string;
  variant?: "primary" | "secondary" | "ink";
}

// The one pick-slip action (owner decision: share-only, no preview page).
// Phone: fetches the generated PDF and hands the actual FILE to the native
// share sheet (WhatsApp gets a real .pdf named after the ref). Desktop (no
// file-share support): opens the PDF route directly — the browser's own
// viewer renders it inline with the proper filename, no per-platform code.
// A dismissed share sheet (AbortError) is not a failure.
export function SharePdfButton({ orderId, orderRef, variant = "secondary" }: SharePdfButtonProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = `/orders/${orderId}/pdf`;

  async function handleClick() {
    setFailed(false);

    // Feature-detect file sharing with a stand-in File BEFORE fetching, so
    // the desktop path never downloads the blob just to throw it away.
    const probe = new File([""], `${orderRef}.pdf`, { type: "application/pdf" });
    const canShareFiles =
      typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [probe] });

    if (!canShareFiles) {
      window.open(url, "_blank", "noopener");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`pdf route returned ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `${orderRef}.pdf`, { type: "application/pdf" });
      try {
        await navigator.share({ files: [file], title: orderRef });
      } catch {
        // AbortError — the user closed the sheet. Not a failure.
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant={variant} onClick={handleClick} loading={busy}>
      <Glyph icon={Share2} />
      {failed ? "Share failed — retry" : "Share PDF"}
    </Button>
  );
}
