"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { createClient } from "@/lib/supabase/client";
import { fetchRetailers, type RetailerRow } from "@/lib/queries/retailers";
import { RetailerModal } from "./RetailerModal";
import styles from "./RetailersQueue.module.css";

type FilterTab = "all" | "pending" | "notSynced" | "verified" | "deactivated";

// A shop the nightly Tally sync didn't match: no balance was ever written.
// Deactivated shops are excluded — nobody is chasing those. NULL is the only
// signal that means "missed"; 0 is a real, square balance.
const isNotSynced = (r: RetailerRow) => r.active && r.outstanding_paise === null;

// S11 — the retailers ledger. Row-click opens the RetailerModal (the same
// window shape as the Products page — owner call 2026-07-11); saving an
// unverified shop verifies it (fixing the spelling IS the verification act).
// Activate/deactivate lives inside the modal now, like Products.
//
// review flag ㉜(🅐), cache edition: render straight from the QUERY CACHE
// (["retailers"], seeded by the page's HydrationBoundary; the same cache
// feeds the Quick Order picker) — see the matching note in
// ProductsPricing.tsx. Post-save router.refresh() feeds this cache too.
export function RetailersQueue() {
  const router = useRouter();
  // Spec D10/D13: `?? []` keeps a painted ledger painted if a background
  // refetch fails; never gate rendering on isError.
  const { data: retailers = [] } = useQuery({
    queryKey: ["retailers"],
    queryFn: () => fetchRetailers(createClient()),
  });
  const queryClient = useQueryClient();
  // Default tab is ALL (owner call 2026-07-11) — pending-verification is one
  // tap away, not the landing view.
  const [tab, setTab] = useState<FilterTab>("all");
  const [editing, setEditing] = useState<RetailerRow | null>(null);
  // Office ADD (owner 2026-08-01) — until now the only way to create a shop
  // anywhere was the salesman's quick-add mid-order, so every new shop was
  // named by someone with no access to Tally. Same modal, no `retailer` prop.
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const counts = {
    all: retailers.length,
    pending: retailers.filter((r) => r.active && !r.verified).length,
    notSynced: retailers.filter(isNotSynced).length,
    verified: retailers.filter((r) => r.active && r.verified).length,
    deactivated: retailers.filter((r) => !r.active).length,
  };

  const q = query.trim().toLowerCase();
  const filtered = retailers.filter((r) => {
    const tabOk =
      tab === "all"
        ? true
        : tab === "pending"
          ? r.active && !r.verified
          : tab === "notSynced"
            ? isNotSynced(r)
            : tab === "verified"
              ? r.active && r.verified
              : !r.active; // deactivated
    if (!tabOk) return false;
    if (q && !`${r.name} ${r.area ?? ""} ${r.phone ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Retailers</h1>
        {/* Desktop entry point; the phone gets the FAB below (Products
            pattern). No import counterpart — shops are added one at a time. */}
        <div className={styles.addDesktop}>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Glyph icon={Store} />
            Add
          </Button>
        </div>
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
          className={`${styles.filterTab} ${tab === "notSynced" ? styles.filterTabActive : ""}`}
          onClick={() => setTab("notSynced")}
        >
          <span className={styles.notSyncedDot}>■</span> Not synced · {counts.notSynced}
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

      <input
        className={styles.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search retailers — name, area or phone"
      />

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {q
            ? `No shops match "${query}".`
            : tab === "pending"
              ? "All shops verified."
              : tab === "notSynced"
                ? "Every active shop matched the last Tally sync."
                : "No shops in this view."}
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((r) => {
            const needsVerification = r.active && !r.verified;
            const isDeactivated = !r.active;
            return (
              <div
                key={r.id}
                className={`${styles.row} ${styles.rowClickable} ${isDeactivated ? styles.rowDeactivated : ""}`}
                onClick={() => setEditing(r)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setEditing(r);
                  }
                }}
              >
                <div className={styles.rowInfo}>
                  <p className={styles.rowName}>
                    {r.name}
                    {needsVerification && <span className={styles.newBadge}>NEW</span>}
                    {isNotSynced(r) && <span className={styles.notSyncedBadge}>NOT SYNCED</span>}
                    {isDeactivated && <span className={styles.deactivatedBadge}>DEACTIVATED</span>}
                  </p>
                  <p className={styles.rowMeta}>
                    {[r.area, r.phone].filter(Boolean).join(" · ") || "No area/phone on file"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Phone FAB — the same entry point as the desktop button. */}
      <button type="button" className={styles.pFab} onClick={() => setAdding(true)}>
        <Glyph icon={Store} />
        Add
      </button>

      {adding && (
        <RetailerModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void queryClient.invalidateQueries({ queryKey: ["retailers"] });
            router.refresh();
          }}
        />
      )}

      {editing && (
        <RetailerModal
          retailer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            // D7: the same ["retailers"] cache feeds the Quick Order picker —
            // a rename/verify reaches the salesman without a reload.
            void queryClient.invalidateQueries({ queryKey: ["retailers"] });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
