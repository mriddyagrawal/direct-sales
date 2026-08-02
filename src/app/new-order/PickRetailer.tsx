"use client";

import { useState } from "react";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { RetailerList } from "@/components/retailers/RetailerList";
import { createClient } from "@/lib/supabase/client";
import { findNameClash, mapRetailerSaveError, resolveTallyLedgerName } from "@/lib/retailer-identity";
import type { RetailerOption } from "./page";
import styles from "./PickRetailer.module.css";

export interface SelectedRetailer {
  id: string;
  name: string;
  area: string | null;
}

interface PickRetailerProps {
  retailers: RetailerOption[];
  recentRetailerIds: string[];
  salesmanId: string;
  onSelect: (retailer: SelectedRetailer) => void;
  onBack: () => void;
}

// S3 — quick-add (verified=false, created_by=self via RLS) wrapped around the
// shared RetailerList, which now owns the search field, the RECENT/ALL SHOPS
// sectioning and the rows. What is left here is what is genuinely the picker's:
// the flow shell, the quick-add screen, the duplicate-clash card and the empty
// state that offers to add the shop you just failed to find.
export function PickRetailer({ retailers, recentRetailerIds, salesmanId, onSelect, onBack }: PickRetailerProps) {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [phone, setPhone] = useState("");
  const [tallyName, setTallyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function select(r: RetailerOption) {
    onSelect({ id: r.id, name: r.name, area: r.area });
  }

  // Live duplicate check against the same list the search reads, normalised
  // exactly as the DB's unique index is (shared norm()) — so what we flag here
  // is precisely what Postgres would refuse.
  const quickAddClash = findNameClash(name, retailers);

  async function submitQuickAdd() {
    if (!name.trim()) {
      setError("Enter the shop name");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("retailers")
      .insert({
        name: name.trim(),
        area: area.trim() || null,
        phone: phone.trim() || null,
        // Blank -> the shop name, never null: _apply_ledger matches on this
        // column only, so a null row would never sync a balance.
        tally_ledger_name: resolveTallyLedgerName(tallyName, name),
        verified: false,
        created_by: salesmanId,
      })
      .select("id, name, area, verified")
      .single();
    setSubmitting(false);
    if (insertError || !data) {
      setError(insertError ? mapRetailerSaveError(insertError.message) : "Could not add the shop.");
      return;
    }
    onSelect({ id: data.id, name: data.name, area: data.area });
  }

  if (showQuickAdd) {
    return (
      <div className={styles.page}>
        <FlowHeader title="Add new shop" onBack={() => setShowQuickAdd(false)} />
        <div className={styles.content}>
          <Field label="Shop name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name" />
          <div className={styles.row}>
            <Field label="Area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area" />
            <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
          {/* The salesman searched and missed it — so don't just warn, hand him
              the shop. One tap takes the same path as picking it from the list,
              which prevents the duplicate instead of scolding him for it. */}
          {quickAddClash && (
            <div className={styles.clash}>
              <p className={styles.clashText}>
                <strong>{quickAddClash.name}</strong>
                {quickAddClash.area ? ` · ${quickAddClash.area}` : ""} is already on the list.
              </p>
              <Button variant="secondary" onClick={() => select(quickAddClash)}>
                Use this shop instead
              </Button>
            </div>
          )}

          {/* Optional and secondary: a salesman in the field has no reason to
              know Tally ledger names, and must never be blocked by this. */}
          <Field
            label="Tally ledger name (optional)"
            value={tallyName}
            onChange={(e) => setTallyName(e.target.value)}
            placeholder={name.trim() || "Same as the shop name"}
          />
          <p className={styles.note}>Leave blank and the shop name is used.</p>

          <p className={styles.note}>
            Saved as NEW — pending verification. Order now; the office cleans up the record later.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <Button variant="primary" onClick={submitQuickAdd} loading={submitting}>
            Add &amp; start order
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Sticky here and nowhere else in the flow: this screen pins nothing
          else, so the header is the only persistent band and stays inside the
          ~10% viewport budget. Scrolling a 599-shop list used to take the
          title and the back arrow with it. */}
      <FlowHeader title="Select retailer" onBack={onBack} sticky />
      <div className={styles.content}>
        <RetailerList
          retailers={retailers}
          recentRetailerIds={recentRetailerIds}
          onSelect={select}
          // Picker-only: the salesman searched, missed, and the useful next
          // move is to add the shop he just typed — not to be told there is
          // nothing here. The list hands back its live query for the seed.
          emptyState={(query) => (
            <div className={styles.empty}>
              <p>No shops match &quot;{query}&quot;.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setName(query);
                  setShowQuickAdd(true);
                }}
              >
                + Add it as a new shop
              </Button>
            </div>
          )}
        />

        <Button variant="secondary" onClick={() => setShowQuickAdd(true)}>
          + Add new shop
        </Button>
      </div>
    </div>
  );
}
