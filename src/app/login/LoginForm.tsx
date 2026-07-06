"use client";

import { useActionState } from "react";
import { signInWithUsername, type LoginState } from "./actions";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import styles from "./login.module.css";

const initialState: LoginState = { error: null };

interface LoginFormProps {
  deactivated: boolean;
}

export function LoginForm({ deactivated }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(signInWithUsername, initialState);

  const error = state.error ?? (deactivated ? "This account has been deactivated. Call the office." : null);

  return (
    <form action={formAction} className={styles.form}>
      {error && <p className={styles.errorStrip}>{error}</p>}
      <Field
        label="Username"
        name="username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <label className={styles.remember}>
        <input type="checkbox" name="rememberMe" defaultChecked />
        Keep me signed in — ~30 DAYS ON THIS PHONE
      </label>
      <Button type="submit" loading={pending} className={styles.submit}>
        Sign in
      </Button>
    </form>
  );
}
