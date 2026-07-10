"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { RetailerRow } from "./page";
import styles from "./RetailerModal.module.css";

interface RetailerModalProps {
  retailer: RetailerRow;
  onClose: () => void;
  onSaved: () => void;
}

// The retailers edit window, deliberately the same shape as the Products
// ProductModal (owner call 2026-07-11): row-click opens it, fields + an
// active toggle + one primary save. Saving an unverified shop verifies it —
// fixing the spelling IS the verification act (S11), so the primary reads
// "Save & verify" until then.
export function RetailerModal({ retailer, onClose, onSaved }: RetailerModalProps) {
  const [name, setName] = useState(retailer.name);
  const [area, setArea] = useState(retailer.area ?? "");
  const [phone, setPhone] = useState(retailer.phone ?? "");
  const [active, setActive] = useState(retailer.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needsVerification = retailer.active && !retailer.verified;

  async function save() {
    if (!name.trim()) {
      setError("Shop name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("retailers")
      .update({
        name: name.trim(),
        area: area.trim() || null,
        phone: phone.trim() || null,
        verified: true,
        active,
      })
      .eq("id", retailer.id);
    if (updateError) {
      setSaving(false);
      setError(updateError.message);
      return;
    }
    onSaved();
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Edit retailer</h2>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className={styles.errorStrip}>{error}</p>}

        <div className={styles.body}>
          <Field label="Shop name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Area" value={area} onChange={(e) => setArea(e.target.value)} />
          <Field label="Phone" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />

          {needsVerification && (
            <p className={styles.helper}>
              Fix the spelling now — this exact name becomes the Tally ledger mapping in Phase 2.
            </p>
          )}

          <button type="button" className={styles.toggle} onClick={() => setActive((a) => !a)}>
            {active ? "Active — click to deactivate" : "Inactive — click to activate"}
          </button>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {needsVerification ? "Save & verify" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
