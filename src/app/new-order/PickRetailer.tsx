"use client";

import { useMemo, useState } from "react";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
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

// S3 — search-as-you-type over name+area, RECENT then ALL SHOPS, NEW tag on
// unverified shops, quick-add (verified=false, created_by=self via RLS).
export function PickRetailer({ retailers, recentRetailerIds, salesmanId, onSelect, onBack }: PickRetailerProps) {
  const [query, setQuery] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (r: RetailerOption) =>
    q === "" || r.name.toLowerCase().includes(q) || (r.area ?? "").toLowerCase().includes(q);

  const byId = useMemo(() => new Map(retailers.map((r) => [r.id, r])), [retailers]);
  const recentIdSet = new Set(recentRetailerIds);
  const recent = recentRetailerIds.map((id) => byId.get(id)).filter((r): r is RetailerOption => !!r && matches(r));
  const all = retailers
    .filter((r) => !recentIdSet.has(r.id) && matches(r))
    .sort((a, b) => a.name.localeCompare(b.name));

  const noResults = q !== "" && recent.length === 0 && all.length === 0;

  function select(r: RetailerOption) {
    onSelect({ id: r.id, name: r.name, area: r.area });
  }

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
        verified: false,
        created_by: salesmanId,
      })
      .select("id, name, area, verified")
      .single();
    setSubmitting(false);
    if (insertError || !data) {
      setError(insertError?.message ?? "Could not add the shop.");
      return;
    }
    onSelect({ id: data.id, name: data.name, area: data.area });
  }

  if (showQuickAdd) {
    return (
      <div className={styles.page}>
        <FlowHeader title="Add new shop" subtitle="NEW ORDER · STEP 1 / 3" onBack={() => setShowQuickAdd(false)} />
        <div className={styles.content}>
          <Field label="Shop name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name" />
          <div className={styles.row}>
            <Field label="Area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area" />
            <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
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
      <FlowHeader title="Select retailer" subtitle="NEW ORDER · STEP 1 / 3" onBack={onBack} />
      <div className={styles.content}>
        <Field
          label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Shop name or area"
        />

        {noResults ? (
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
        ) : (
          <>
            {recent.length > 0 && (
              <section>
                <p className={styles.sectionLabel}>RECENT</p>
                {recent.map((r) => (
                  <RetailerRow key={r.id} retailer={r} onSelect={() => select(r)} />
                ))}
              </section>
            )}
            {all.length > 0 && (
              <section>
                <p className={styles.sectionLabel}>ALL SHOPS</p>
                {all.map((r) => (
                  <RetailerRow key={r.id} retailer={r} onSelect={() => select(r)} />
                ))}
              </section>
            )}
          </>
        )}

        <Button variant="secondary" onClick={() => setShowQuickAdd(true)}>
          + Add new shop
        </Button>
      </div>
    </div>
  );
}

function RetailerRow({ retailer, onSelect }: { retailer: RetailerOption; onSelect: () => void }) {
  return (
    <button type="button" className={styles.retailerRow} onClick={onSelect}>
      <span className={styles.retailerName}>{retailer.name}</span>
      <span className={styles.retailerMeta}>
        {retailer.area && <span>{retailer.area}</span>}
        {!retailer.verified && <span className={styles.newTag}>NEW</span>}
      </span>
    </button>
  );
}
