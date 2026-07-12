"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./SignOutButton.module.css";

export function SignOutButton() {
  const router = useRouter();
  // Sign-out is a network round-trip + redirect — without feedback the app
  // feels frozen after the tap. Show a pending label and block a double-tap.
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
    // No reset: the component unmounts on navigation to /login.
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
