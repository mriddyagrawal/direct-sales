"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { pushState, enablePush, repairSubscription, clearShownNotifications, type PushState } from "@/lib/push";
import styles from "./NotificationsBell.module.css";

// THE enable surface for push — a state-aware bell, nothing else (spec v1.2,
// owner call: no soft-ask cards; staff are onboarded verbally — "tap the
// bell, hit Allow"). States:
//   unsupported → renders nothing (incl. iOS Safari outside the installed PWA)
//   granted     → renders nothing; silently self-repairs the subscription and
//                 clears shown notifications + badge on every open (R6)
//   default     → bell with a dot; tap fires THE one native dialog (gesture)
//   denied      → muted bell; tap opens the Settings instruction sheet — the
//                 native dialog can never be re-shown programmatically
export function NotificationsBell() {
  // Render nothing on the server and first client paint (no hydration
  // mismatch); the real state arrives in the mount effect.
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    // Async tick: the permission state lives in an external system (the
    // browser), and the repo lint (rightly) bars synchronous setState in an
    // effect body — resolve it in a microtask callback instead.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const s = pushState();
      setState(s);
      if (s === "granted") {
        void repairSubscription();
        void clearShownNotifications();
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null || state === "unsupported" || state === "granted") return null;

  async function onTap() {
    if (busy) return;
    if (state === "denied") {
      setShowHelp(true);
      return;
    }
    setBusy(true);
    try {
      const result = await enablePush();
      setState(result);
      if (result === "denied") setShowHelp(true);
    } catch {
      // Subscription save failed — keep the bell; next tap retries.
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.bell}
        onClick={() => void onTap()}
        disabled={busy}
        aria-label={state === "denied" ? "Notifications blocked — how to enable" : "Enable notifications"}
      >
        <Glyph icon={state === "denied" ? BellOff : Bell} />
        {state === "default" && <span className={styles.dot} />}
      </button>

      {showHelp && (
        <BottomSheet onClose={() => setShowHelp(false)}>
          <div className={styles.help}>
            <p className={styles.helpTitle}>Notifications are blocked for this app</p>
            <p className={styles.helpBody}>
              The phone remembers your earlier choice, so the app can&apos;t ask again. To turn them on:
              open <strong>Settings → Notifications → Ganpati Enterprises</strong> and switch on{" "}
              <strong>Allow Notifications</strong> — then reopen the app and tap the bell once more.
            </p>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
