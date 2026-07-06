"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import styles from "./login.module.css";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deactivated = searchParams.get("reason") === "deactivated";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    deactivated ? "This account has been deactivated. Call the office." : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("Wrong email or password.");
      setLoading(false);
      return;
    }

    // Role routing happens in the proxy (middleware) based on the caller's
    // profile — a plain navigation to "/" lets it redirect accountant/admin
    // to /dashboard as needed.
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {error && <p className={styles.errorStrip}>{error}</p>}
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <label className={styles.remember}>
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        Keep me signed in — ~30 DAYS ON THIS PHONE
      </label>
      <Button type="submit" loading={loading} className={styles.submit}>
        Sign in
      </Button>
    </form>
  );
}
