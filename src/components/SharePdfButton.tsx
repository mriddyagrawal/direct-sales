"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";

interface SharePdfButtonProps {
  // The PDF route to fetch. Generalised from a hardcoded /orders/[id]/pdf when
  // the retailer statement became the second shareable document (2026-08-04) —
  // the sharing behaviour below is identical for both, and a second copy of it
  // is how the two would drift apart on the Android caption quirk.
  url: string;
  // Carried by the caller because each document names itself differently: an
  // order leads with its ref, a statement with the shop and the date.
  fileName: string;
  variant?: "primary" | "secondary" | "ink";
}

// THE share action for every generated PDF — the pick slip and the retailer
// statement (owner decision: share-only, no preview page).
// Phone: fetches the generated PDF and hands the actual FILE to the native
// share sheet. The file is named "<ref> - <Retailer>.pdf" — that's the SINGLE
// carrier of the retailer name, shown as the document title on BOTH platforms.
// We deliberately DON'T also pass a text/title caption: Android drops it when a
// file is attached (so it'd surface on iOS only, where it would just duplicate
// the filename). Filename-only = the name shows once, consistently. Desktop (no
// file-share support): opens the PDF route directly — the browser's own
// viewer renders it inline with the proper filename, no per-platform code.
// A dismissed share sheet (AbortError) is not a failure.
export function SharePdfButton({ url, fileName, variant = "secondary" }: SharePdfButtonProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setFailed(false);

    // Feature-detect file sharing with a stand-in File BEFORE fetching, so
    // the desktop path never downloads the blob just to throw it away.
    const probe = new File([""], fileName, { type: "application/pdf" });
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
      const file = new File([blob], fileName, { type: "application/pdf" });
      try {
        await navigator.share({ files: [file] });
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
    // While the PDF is being fetched the button INVERTS to ink (owner
    // feedback) and keeps its label — no white spinner square, no width
    // collapse. Disabled guards double-taps during the ~2s fetch.
    <Button
      type="button"
      // Preparing = the INVERSE of the resting look (owner call): an ink
      // button flips to white, a white/accent one flips to ink.
      variant={busy ? (variant === "ink" ? "secondary" : "ink") : variant}
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy || undefined}
    >
      <Glyph icon={Share2} />
      {busy ? "Preparing…" : failed ? "Share failed — retry" : "Share"}
    </Button>
  );
}
