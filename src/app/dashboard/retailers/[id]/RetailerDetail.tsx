"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { StatusTag } from "@/components/ui/StatusTag";
import { RetailerModal } from "../RetailerModal";
import type { RetailerRow } from "../page";
import styles from "./RetailerDetail.module.css";

// The edit entry point moved HERE from the row click (spec 2026-08-01).
// RetailerModal is deliberately NOT retired: it stays the single editor, now
// reached from exactly two deliberate places — Add on the queue, Edit here —
// rather than from an accidental row tap. One editor means one copy of the
// save rules (blank ledger name -> shop name, rename safety, duplicate guard).
export function RetailerDetail({ retailer }: { retailer: RetailerRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const rows: { label: string; value: string }[] = [
    { label: "Area", value: retailer.area || "—" },
    { label: "Phone", value: retailer.phone || "—" },
    // Editor-only elsewhere (it is 596-of-599 identical to the name, so it is
    // noise in the LIST) — but this IS the editing surface, so it shows.
    { label: "Tally ledger name", value: retailer.tally_ledger_name || "— not linked —" },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.backRow}>
        <BackLink fallback="/dashboard/retailers" className={styles.breadcrumb}>
          ‹ Retailers
        </BackLink>
        {/* Tones match the queue's badges: amber NEW, accent NOT SYNCED, grey
            DEACTIVATED — same signal, same colour, two surfaces. */}
        <div className={styles.tags}>
          {retailer.active && !retailer.verified && <StatusTag tone="amber" label="New" />}
          {retailer.active && retailer.outstanding_paise === null && (
            <StatusTag tone="accent" label="Not synced" />
          )}
          {!retailer.active && <StatusTag tone="locked" label="Deactivated" />}
        </div>
      </div>

      <div className={styles.headRow}>
        <h1 className={styles.title}>{retailer.name}</h1>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Glyph icon={Pencil} />
          Edit
        </Button>
      </div>

      <dl className={styles.facts}>
        {rows.map((r) => (
          <div key={r.label} className={styles.fact}>
            <dt className={styles.factLabel}>{r.label}</dt>
            <dd className={styles.factValue}>{r.value}</dd>
          </div>
        ))}
      </dl>

      {editing && (
        <RetailerModal
          retailer={retailer}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void queryClient.invalidateQueries({ queryKey: ["retailers"] });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
