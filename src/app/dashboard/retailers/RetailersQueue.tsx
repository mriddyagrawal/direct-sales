"use client";

import { useState } from "react";
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
export function RetailersQueue({ initialRetailers }: { initialRetailers: RetailerRow[] }) {
  const router = useRouter();
  const [retailers] = useState(initialRetailers);
  const [tab, setTab] = useState<FilterTab>("pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({ name: "", area: "", phone: "" });
  const [saving, setSaving] = useState(false);
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
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function setActive(id: string, active: boolean) {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.from("retailers").update({ active }).eq("id", id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
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
              const isPending = !r.verified;
              return (
                <div key={r.id} className={styles.editCard}>
                  <div className={styles.editRow}>
                    <Field label="Shop name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className={styles.editRow}>
                    <Field label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
                    <Field label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  {isPending && (
                    <p className={styles.helper}>
                      Fix the spelling now — this exact name becomes the Tally ledger mapping in Phase 2.
                    </p>
                  )}
                  <div className={styles.editActions}>
                    <Button variant="secondary" onClick={discardEdit}>
                      Discard
                    </Button>
                    <Button variant="primary" onClick={() => saveAndVerify(r.id)} loading={saving}>
                      Save &amp; verify
                    </Button>
                  </div>
                </div>
              );
            }

            const isPending = r.active && !r.verified;
            const isDeactivated = !r.active;

            return (
              <div
                key={r.id}
                className={`${styles.row} ${isDeactivated ? styles.rowDeactivated : ""}`}
                onClick={isPending ? () => startEdit(r) : undefined}
                role={isPending ? "button" : undefined}
                tabIndex={isPending ? 0 : undefined}
                onKeyDown={
                  isPending
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") startEdit(r);
                      }
                    : undefined
                }
              >
                <div className={styles.rowInfo}>
                  <p className={styles.rowName}>
                    {r.name}
                    {isPending && <span className={styles.newBadge}>NEW</span>}
                    {isDeactivated && <span className={styles.deactivatedBadge}>DEACTIVATED</span>}
                  </p>
                  <p className={styles.rowMeta}>
                    {[r.area, r.phone].filter(Boolean).join(" · ") || "No area/phone on file"}
                  </p>
                </div>
                <div className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                  {isDeactivated ? (
                    <Button variant="secondary" onClick={() => setActive(r.id, true)} disabled={saving}>
                      Reactivate
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => startEdit(r)} disabled={saving}>
                        Edit
                      </Button>
                      <Button variant="destructive" onClick={() => setActive(r.id, false)} disabled={saving}>
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
