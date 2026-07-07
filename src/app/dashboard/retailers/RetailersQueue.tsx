"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { RetailerRow } from "./page";
import styles from "./RetailersQueue.module.css";

type FilterTab = "all" | "pending" | "verified" | "deactivated";

interface EditForm {
  name: string;
  area: string;
  phone: string;
}

// S11 — verification queue. A pending row opens straight into inline edit;
// fixing the spelling *is* the verification act (one motion, one Save).
//
// review flag ㉜(🅐): render straight from the `initialRetailers` prop, never
// copied into useState — see the matching note in ProductsPricing.tsx.
export function RetailersQueue({ initialRetailers: retailers }: { initialRetailers: RetailerRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({ name: "", area: "", phone: "" });
  const [saving, setSaving] = useState(false);
  // review flag ㉜(🅑): which specific row/action is busy, so the spinner
  // lands on the button actually clicked rather than dimming the whole list.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const counts = {
    all: retailers.length,
    pending: retailers.filter((r) => r.active && !r.verified).length,
    verified: retailers.filter((r) => r.active && r.verified).length,
    deactivated: retailers.filter((r) => !r.active).length,
  };

  const filtered = retailers.filter((r) => {
    if (tab === "pending") return r.active && !r.verified;
    if (tab === "verified") return r.active && r.verified;
    if (tab === "deactivated") return !r.active;
    return true;
  });

  function startEdit(r: RetailerRow) {
    setEditingId(r.id);
    setForm({ name: r.name, area: r.area ?? "", phone: r.phone ?? "" });
    setError(null);
  }

  function discardEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveAndVerify(id: string) {
    if (!form.name.trim()) {
      setError("Shop name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("retailers")
      .update({
        name: form.name.trim(),
        area: form.area.trim() || null,
        phone: form.phone.trim() || null,
        verified: true,
      })
      .eq("id", id);
    if (updateError) {
      setSaving(false);
      setError(updateError.message);
      return;
    }
    setEditingId(null);
    setSaving(false);
    // Stay busy through the refresh (㉜🅑) — see ProductsPricing.tsx note.
    startTransition(() => {
      router.refresh();
    });
  }

  async function setActive(id: string, active: boolean) {
    const key = `${id}:${active ? "reactivate" : "deactivate"}`;
    setBusyKey(key);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from("retailers").update({ active }).eq("id", id);
    if (updateError) {
      setBusyKey(null);
      setError(updateError.message);
      return;
    }
    startTransition(() => {
      router.refresh();
      setBusyKey(null);
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Retailers</h1>
      </div>

      <div className={styles.filterTabs}>
        <button type="button" className={`${styles.filterTab} ${tab === "all" ? styles.filterTabActive : ""}`} onClick={() => setTab("all")}>
          All · {counts.all}
        </button>
        <button
          type="button"
          className={`${styles.filterTab} ${tab === "pending" ? styles.filterTabActive : ""}`}
          onClick={() => setTab("pending")}
        >
          <span className={styles.pendingDot}>■</span> Pending · {counts.pending}
        </button>
        <button
          type="button"
          className={`${styles.filterTab} ${tab === "verified" ? styles.filterTabActive : ""}`}
          onClick={() => setTab("verified")}
        >
          Verified · {counts.verified}
        </button>
        <button
          type="button"
          className={`${styles.filterTab} ${tab === "deactivated" ? styles.filterTabActive : ""}`}
          onClick={() => setTab("deactivated")}
        >
          Deactivated · {counts.deactivated}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {filtered.length === 0 ? (
        <div className={styles.empty}>{tab === "pending" ? "All shops verified." : "No shops in this view."}</div>
      ) : (
        <div className={styles.list}>
          {filtered.map((r) => {
            if (editingId === r.id) {
              const needsVerification = !r.verified;
              return (
                <div key={r.id} className={styles.editCard}>
                  <div className={styles.editRow}>
                    <Field label="Shop name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className={styles.editRow}>
                    <Field label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
                    <Field label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  {needsVerification && (
                    <p className={styles.helper}>
                      Fix the spelling now — this exact name becomes the Tally ledger mapping in Phase 2.
                    </p>
                  )}
                  <div className={styles.editActions}>
                    <Button variant="secondary" onClick={discardEdit}>
                      Discard
                    </Button>
                    <Button variant="primary" onClick={() => saveAndVerify(r.id)} loading={saving || isPending}>
                      Save &amp; verify
                    </Button>
                  </div>
                </div>
              );
            }

            const needsVerification = r.active && !r.verified;
            const isDeactivated = !r.active;

            return (
              <div
                key={r.id}
                className={`${styles.row} ${isDeactivated ? styles.rowDeactivated : ""}`}
                onClick={needsVerification ? () => startEdit(r) : undefined}
                role={needsVerification ? "button" : undefined}
                tabIndex={needsVerification ? 0 : undefined}
                onKeyDown={
                  needsVerification
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") startEdit(r);
                      }
                    : undefined
                }
              >
                <div className={styles.rowInfo}>
                  <p className={styles.rowName}>
                    {r.name}
                    {needsVerification && <span className={styles.newBadge}>NEW</span>}
                    {isDeactivated && <span className={styles.deactivatedBadge}>DEACTIVATED</span>}
                  </p>
                  <p className={styles.rowMeta}>
                    {[r.area, r.phone].filter(Boolean).join(" · ") || "No area/phone on file"}
                  </p>
                </div>
                <div className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                  {isDeactivated ? (
                    <Button
                      variant="secondary"
                      onClick={() => setActive(r.id, true)}
                      loading={busyKey === `${r.id}:reactivate`}
                    >
                      Reactivate
                    </Button>
                  ) : needsVerification ? (
                    <>
                      {/* review flag ㉜(🅒): pending rows previously offered only Edit +
                          Deactivate — verifying only happened via the row's onClick, which
                          isn't discoverable. This is the explicit primary action. */}
                      <Button variant="primary" onClick={() => startEdit(r)}>
                        Review &amp; verify
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setActive(r.id, false)}
                        loading={busyKey === `${r.id}:deactivate`}
                      >
                        Deactivate
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => startEdit(r)}>
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setActive(r.id, false)}
                        loading={busyKey === `${r.id}:deactivate`}
                      >
                        Deactivate
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
