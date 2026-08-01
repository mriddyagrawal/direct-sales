"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import {
  findNameClash,
  mapRetailerSaveError,
  resolveTallyLedgerName,
} from "@/lib/retailer-identity";
import type { RetailerRow } from "./page";
import styles from "./RetailerModal.module.css";

interface RetailerModalProps {
  // Absent = ADD mode. Until 2026-08-01 the office could only ever EDIT: the
  // one way to create a shop anywhere in the app was the salesman's quick-add
  // inside the order flow, which meant every new shop was named (and
  // ledger-linked) by someone with no access to Tally.
  retailer?: RetailerRow;
  onClose: () => void;
  onSaved: () => void;
}

// The retailers add/edit window, deliberately the same shape as the Products
// ProductModal (owner call 2026-07-11): row-click opens it, fields + an
// active toggle + one primary save. Saving an unverified shop verifies it —
// fixing the spelling IS the verification act (S11), so the primary reads
// "Save & verify" until then. An office-created shop is verified on the spot:
// the office IS the verifier.
export function RetailerModal({ retailer, onClose, onSaved }: RetailerModalProps) {
  const isAdd = retailer === undefined;
  const [name, setName] = useState(retailer?.name ?? "");
  const [area, setArea] = useState(retailer?.area ?? "");
  const [phone, setPhone] = useState(retailer?.phone ?? "");
  const [tallyName, setTallyName] = useState(retailer?.tally_ledger_name ?? "");
  const [active, setActive] = useState(retailer?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The office list already populates ["retailers"]; read it for the live
  // duplicate check rather than re-fetching (Slice B cache).
  const queryClient = useQueryClient();
  const cachedRetailers = queryClient.getQueryData<RetailerRow[]>(["retailers"]) ?? [];
  const nameClash = findNameClash(name, cachedRetailers, retailer?.id);
  // Only warn about the rename once there IS a link to protect and the name
  // has actually been edited — otherwise it's noise on every open.
  const hadLink = (retailer?.tally_ledger_name ?? "").trim() !== "";
  const renamed = !isAdd && name.trim() !== retailer!.name.trim();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needsVerification = !isAdd && retailer!.active && !retailer!.verified;

  async function save() {
    if (!name.trim()) {
      setError("Shop name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const fields = {
      name: name.trim(),
      area: area.trim() || null,
      phone: phone.trim() || null,
      // Blank -> the shop name, never null; on edit an already-set link is
      // kept even if the shop was renamed (see resolveTallyLedgerName).
      tally_ledger_name: resolveTallyLedgerName(tallyName, name, retailer?.tally_ledger_name),
      // Office-created and office-edited shops are verified either way: the
      // office is the authority this flag exists to represent.
      verified: true,
      active,
    };

    let dbError;
    if (isAdd) {
      // created_by is the audit trail the salesman path already writes; keep
      // it truthful for office-created shops too.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      ({ error: dbError } = await supabase.from("retailers").insert({ ...fields, created_by: user?.id ?? null }));
    } else {
      ({ error: dbError } = await supabase.from("retailers").update(fields).eq("id", retailer!.id));
    }

    if (dbError) {
      setSaving(false);
      setError(mapRetailerSaveError(dbError.message));
      return;
    }
    onSaved();
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>{isAdd ? "Add retailer" : "Edit retailer"}</h2>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className={styles.errorStrip}>{error}</p>}

        <div className={styles.body}>
          <Field label="Shop name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Area" value={area} onChange={(e) => setArea(e.target.value)} />
          <Field label="Phone" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />

          {nameClash && (
            <p className={styles.warning}>
              “{nameClash.name}”{nameClash.area ? ` · ${nameClash.area}` : ""} already uses this name. Two shops
              can’t share one name — saving will be refused.
            </p>
          )}

          <Field
            label="Tally ledger name"
            value={tallyName}
            onChange={(e) => setTallyName(e.target.value)}
            placeholder={name.trim() || "Same as the shop name"}
          />
          <p className={styles.hint}>
            Leave this blank and the shop name is used. The nightly sync matches on this to bring in the
            shop’s outstanding balance.
          </p>
          {hadLink && renamed && (
            <p className={styles.helper}>
              Renaming the shop won’t change this — the sync keeps using “{retailer!.tally_ledger_name}”. Edit
              the field above if the Tally ledger was renamed too.
            </p>
          )}

          {needsVerification && (
            <p className={styles.helper}>Fix the spelling now — saving marks this shop verified.</p>
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
            {isAdd ? "Add retailer" : needsVerification ? "Save & verify" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
