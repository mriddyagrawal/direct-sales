"use client";

import { useEffect } from "react";

// Registers the minimal installability service worker (public/sw.js). See the
// comment there — no caching, purely what flips Chrome's add-to-home-screen
// from a badged shortcut to a real installed app. Renders nothing.
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing (old browser, private mode) just means no
        // install prompt — the app itself is unaffected. Nothing to surface.
      });
    }
  }, []);
  return null;
}
