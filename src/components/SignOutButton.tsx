"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./SignOutButton.module.css";

export function SignOutButton() {
  // Sign-out is a network round-trip + redirect — without feedback the app
  // feels frozen after the tap. Show a pending label and block a double-tap.
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    // D9 (client-data-cache spec): sign out FIRST (clears the auth cookies),
    // THEN a HARD navigation — location.assign, not router.push — so the whole
    // JS heap (query cache, router cache, component state) dies with the
    // session. AuthCacheGuard's SIGNED_OUT listener also fires and clears the
    // data cache; the assign here is the belt to its suspenders.
    await supabase.auth.signOut();
    window.location.assign("/login");
    // No reset: the hard navigation replaces the document.
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      aria-busy={busy || undefined}
      className={styles.button}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
