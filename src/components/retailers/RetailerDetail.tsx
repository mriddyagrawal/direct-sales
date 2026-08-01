"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { StatusTag } from "@/components/ui/StatusTag";
import { RetailerModal } from "../RetailerModal";
import type { RetailerRow } from "../page";
import back from "@/components/ui/back.module.css";
import styles from "./RetailerDetail.module.css";

// The edit entry point moved HERE from the row click (spec 2026-08-01).
// RetailerModal is deliberately NOT retired: it stays the single editor, now
// reached from exactly two deliberate places — Add on the queue, Edit here —
// rather than from an accidental row tap. One editor means one copy of the
// save rules (blank ledger name -> shop name, rename safety, duplicate guard).
//
// ONE component, two lenses (spec retailer-detail-salesman-lens, step 1) —
// exactly as OrderDetailView serves salesman/staff/godown off one `role` prop.
// The lens is NOT a security boundary: RLS is. A salesman reading an inactive
// shop gets no row (retailers_select_salesman is `active` only) and the route
// 404s on its own. What `role` decides is what's WORTH showing.
export function RetailerDetail({
  retailer,
  role,
}: {
  retailer: RetailerRow;
  role: "salesman" | "staff";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const isStaff = role === "staff";

  const rows: { label: string; value: string }[] = [
    { label: "Area", value: retailer.area || "—" },
    { label: "Phone", value: retailer.phone || "—" },
    // Editor-only (it is 596-of-599 identical to the name, so it is noise
    // anywhere it isn't being edited). Staff can edit here, so it shows; the
    // salesman lens has no editing, so it has nothing to serve.
    ...(isStaff
      ? [{ label: "Tally ledger name", value: retailer.tally_ledger_name || "— not linked —" }]
      : []),
  ];

  return (
    <div className={styles.page}>
      <div className={back.row}>
        {/* CONTEXTUAL back, and the label is why that is sound: reduced to the
            bare word "Back", the arrow promises no particular screen, so
            "return to where you came from" cannot break a promise. The
            deciding journey is the admin's — approve an order → open the shop
            to check it is creditworthy → return to THAT order. A hierarchical
            back would dump them on the retailers list every time.
            `href` stays the lens default so SSR, cmd-click and no-JS still
            land somewhere real; the salesman has no retailers list, so his is
            the salesman home.
            Chrome comes from the SHARED back stylesheet — identical glyph,
            size and placement to order detail (owner 2026-08-01). */}
        <BackLink contextual fallback={isStaff ? "/dashboard/retailers" : "/"} className={back.link}>
          <Glyph icon={ChevronLeft} />
          <span className={back.label}>Back</span>
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
        {/* Staff-only, and NOT because the salesman's write is unsafe — RLS
            already refuses it (retailers_staff_update is accountant/admin).
            An affordance that can only ever produce a raw RLS error is worse
            than no affordance. (Closes flag 59.) */}
        {isStaff && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Glyph icon={Pencil} />
            Edit
          </Button>
        )}
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
