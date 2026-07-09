"use client";

import { useEffect } from "react";

// Warms the ZXing chunks the moment a godown user lands on the queue, so the
// first pick screen opens with the scanner ready (no dynamic-import fetch
// delay on a warehouse connection). Same dynamic specifiers as Scanner.tsx →
// same route-split async chunks; ZXing still never rides in the salesman/
// accountant/admin bundles. Renders nothing.
export function PreloadScanner() {
  useEffect(() => {
    void import("@zxing/browser").catch(() => {});
    void import("@zxing/library").catch(() => {});
  }, []);
  return null;
}
