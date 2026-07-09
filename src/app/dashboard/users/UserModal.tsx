"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createUser, updateUserProfile, resetUserPassword, setUserActive } from "./actions";
import type { UserRow } from "./page";
import styles from "./UserModal.module.css";

interface UserModalProps {
  mode: "add" | "edit";
  callerId: string;
  initial?: UserRow;
  onClose: () => void;
  onSaved: () => void;
}

// value = stored identifier (unchanged — CHECK/RLS/RPCs depend on it);
// label = owner-facing terminology ("Sales" / "Accounts").
const ROLES: { value: string; label: string }[] = [
  { value: "salesman", label: "Sales" },
  { value: "godown", label: "Godown" },
  { value: "accountant", label: "Accounts" },
  { value: "admin", label: "Admin" },
];

// Shared Add/Edit modal, mirroring ProductModal. All writes go through the
// gated Server Actions (service-role, admin-checked) — this component never
// touches Supabase directly. Passwords are typed twice and must match before
// submit (there's no email-reset safety net); only the confirmed value is sent
// and it is never echoed back after creation beyond the one-time reveal.
export function UserModal({ mode, callerId, initial, onClose, onSaved }: UserModalProps) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [role, setRole] = useState(initial?.role ?? "salesman");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [busyActive, setBusyActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit-mode reset-password sub-form (hidden until asked for).
  const [resetting, setResetting] = useState(false);
  const [resetPw, setResetPw] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Add-mode success: show the credentials once (the password won't be
  // retrievable later). `created` holds what to display.
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isSelf = mode === "edit" && initial?.id === callerId;

  async function save() {
    setError(null);
    if (mode === "add") {
      if (password.length < 8) return setError("Password must be at least 8 characters.");
      if (password !== confirm) return setError("Passwords don't match.");
      setSaving(true);
      const { error: actionError } = await createUser({ email, password, username, full_name: fullName, role });
      if (actionError) {
        setSaving(false);
        return setError(actionError);
      }
      // Success — reveal credentials once instead of closing immediately.
      setCreated({ username: username.trim(), password });
      setSaving(false);
    } else {
      setSaving(true);
      const { error: actionError } = await updateUserProfile(initial!.id, { username, full_name: fullName, role });
      if (actionError) {
        setSaving(false);
        return setError(actionError);
      }
      onSaved();
    }
  }

  async function toggleActive() {
    if (!initial) return;
    const next = !active;
    setBusyActive(true);
    setError(null);
    const { error: actionError } = await setUserActive(initial.id, next);
    setBusyActive(false);
    if (actionError) return setError(actionError);
    setActive(next);
  }

  async function submitReset() {
    setError(null);
    if (resetPw.length < 8) return setError("Password must be at least 8 characters.");
    if (resetPw !== resetConfirm) return setError("Passwords don't match.");
    setResetSaving(true);
    const { error: actionError } = await resetUserPassword(initial!.id, resetPw);
    setResetSaving(false);
    if (actionError) return setError(actionError);
    setResetDone(true);
    setResetting(false);
    setResetPw("");
    setResetConfirm("");
  }

  // ---- Add success screen: show credentials once ----
  if (created) {
    return (
      <div className={styles.scrim} onClick={onSaved}>
        <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 className={styles.heading}>User created</h2>
          </div>
          <p className={styles.oneTimeNote}>
            Share these credentials with the user now — the password won&apos;t be shown again.
          </p>
          <div className={styles.creds}>
            <div>
              <span className={styles.credLabel}>USERNAME</span>
              <span className={styles.credValue}>{created.username}</span>
            </div>
            <div>
              <span className={styles.credLabel}>PASSWORD</span>
              <span className={styles.credValue}>{created.password}</span>
            </div>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onSaved}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>{mode === "add" ? "Add user" : "Edit user"}</h2>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className={styles.errorStrip}>{error}</p>}

        <div className={styles.body}>
          {mode === "add" && (
            <Field label="Email" value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          )}

          <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Field label="Display name" value={fullName} onChange={(e) => setFullName(e.target.value)} />

          <div className={styles.selectField}>
            <label className={styles.label} htmlFor="um-role">
              Role
            </label>
            {/* Disabled when editing yourself: the action rejects self-demotion
                server-side (㊶), and disabling here stops you picking a role
                that would only error on save. */}
            <select
              id="um-role"
              className={styles.select}
              value={role}
              disabled={isSelf}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {isSelf && <span className={styles.hint}>You can&apos;t change your own admin role.</span>}
          </div>

          {mode === "add" && (
            <>
              <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Field
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </>
          )}

          {mode === "edit" && (
            <div className={styles.section}>
              <div className={styles.sectionRow}>
                <span className={styles.label}>Account</span>
                <button
                  type="button"
                  className={`${styles.toggle} ${active ? styles.toggleOn : styles.toggleOff}`}
                  onClick={toggleActive}
                  disabled={busyActive}
                >
                  {active ? "Active" : "Inactive"}
                </button>
              </div>

              {resetDone && <p className={styles.hint}>Password updated.</p>}
              {!resetting ? (
                <button type="button" className={styles.linkButton} onClick={() => setResetting(true)}>
                  Reset password
                </button>
              ) : (
                <div className={styles.resetBox}>
                  <Field
                    label="New password"
                    type="password"
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                  />
                  <Field
                    label="Confirm new password"
                    type="password"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                  />
                  <div className={styles.resetActions}>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setResetting(false);
                        setResetPw("");
                        setResetConfirm("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={submitReset} loading={resetSaving}>
                      Set password
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {mode === "add" ? "Create user" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
