"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { UserModal } from "./UserModal";
import { setUserActive } from "./actions";
import type { UserRow } from "./page";
import styles from "./UsersAdmin.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; user: UserRow } | null;

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  accountant: "Accountant",
  salesman: "Salesman",
};

// Mirrors ProductsPricing: desktop table + mobile cards, row-click opens the
// edit modal, "+ Add user" opens the add modal, and the inline Active toggle
// uses the same useOptimistic overlay + busy-Set + router.refresh() pattern —
// but writes through the setUserActive Server Action (service-role, gated),
// never a client supabase call. Renders straight from the `users` prop (㉜🅐):
// each mutation calls router.refresh() to pull fresh server data.
export function UsersAdmin({ users, callerId }: { users: UserRow[]; callerId: string }) {
  const router = useRouter();
  const [displayUsers, applyOptimisticActive] = useOptimistic(
    users,
    (state: UserRow[], patch: { id: string; active: boolean }) =>
      state.map((u) => (u.id === patch.id ? { ...u, active: patch.active } : u)),
  );
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const activeCount = users.filter((u) => u.active).length;

  function toggleActive(u: UserRow) {
    const next = !u.active;
    setBusy((prev) => new Set(prev).add(u.id));
    setError(null);
    startTransition(async () => {
      applyOptimisticActive({ id: u.id, active: next });
      const { error: actionError } = await setUserActive(u.id, next);
      if (actionError) setError(actionError);
      else router.refresh();
      setBusy((prev) => {
        const s = new Set(prev);
        s.delete(u.id);
        return s;
      });
    });
  }

  function closeAndRefresh() {
    setModal(null);
    router.refresh();
  }

  function activeToggle(u: UserRow) {
    return (
      <button
        type="button"
        className={`${styles.toggle} ${u.active ? styles.toggleOn : styles.toggleOff}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleActive(u);
        }}
        disabled={busy.has(u.id)}
      >
        {u.active ? "Active" : "Inactive"}
      </button>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Users</h1>
        <span className={styles.count}>
          {users.length} users · {activeCount} active
        </span>
        <div className={styles.titleActions}>
          <Button variant="primary" onClick={() => setModal({ mode: "add" })}>
            + Add user
          </Button>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>USERNAME</th>
            <th>DISPLAY NAME</th>
            <th>ROLE</th>
            <th>EMAIL</th>
            <th>ACTIVE</th>
          </tr>
        </thead>
        <tbody>
          {displayUsers.map((u) => (
            <tr
              key={u.id}
              className={`${styles.clickable} ${!u.active ? styles.rowInactive : ""}`}
              onClick={() => setModal({ mode: "edit", user: u })}
            >
              <td className={`${styles.mono} ${styles.cellName}`}>{u.username ?? "—"}</td>
              <td className={styles.cellMeta}>{u.full_name}</td>
              <td className={styles.cellMeta}>{ROLE_LABEL[u.role] ?? u.role}</td>
              <td className={`${styles.mono} ${styles.cellMeta}`}>{u.email || "—"}</td>
              <td onClick={(e) => e.stopPropagation()}>{activeToggle(u)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.cards}>
        {displayUsers.map((u) => (
          <div
            key={u.id}
            className={`${styles.card} ${styles.clickable} ${!u.active ? styles.cardInactive : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setModal({ mode: "edit", user: u })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setModal({ mode: "edit", user: u });
              }
            }}
          >
            <div className={styles.cardTop}>
              <span className={styles.cardName}>{u.username ?? u.full_name}</span>
              <span className={styles.cardRole}>{ROLE_LABEL[u.role] ?? u.role}</span>
            </div>
            <div className={styles.cardMeta}>{u.full_name}</div>
            <div className={styles.cardMeta}>{u.email || "—"}</div>
            {activeToggle(u)}
          </div>
        ))}
      </div>

      {modal && (
        <UserModal
          mode={modal.mode}
          callerId={callerId}
          initial={modal.mode === "edit" ? modal.user : undefined}
          onClose={() => setModal(null)}
          onSaved={closeAndRefresh}
        />
      )}
    </div>
  );
}
