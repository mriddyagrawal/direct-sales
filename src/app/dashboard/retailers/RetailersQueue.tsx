"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { createClient } from "@/lib/supabase/client";
import { fetchRetailers, type RetailerRow } from "@/lib/queries/retailers";
import { readBalance } from "@/lib/balance";
import Link from "next/link";
import { RetailerModal } from "./RetailerModal";
import fab from "@/components/ui/fab.module.css";
import table from "@/components/ui/table.module.css";
import styles from "./RetailersQueue.module.css";

type FilterTab = "all" | "pending" | "notSynced" | "verified" | "deactivated";

// A shop the nightly Tally sync didn't match: no balance was ever written.
// Deactivated shops are excluded — nobody is chasing those. NULL is the only
// signal that means "missed"; 0 is a real, square balance.
const isNotSynced = (r: RetailerRow) => r.active && r.outstanding_paise === null;

// The reading itself now lives in lib/balance.ts, shared with the salesman's
// picker row and Retailers tab — this page was the FIRST surface, not the only
// one, and its old comment's "ONE definition" claim only stayed true by moving.
// What stays here is the mapping from the shared state to THIS stylesheet's
// classes, which is all that was ever page-specific: a CSS-module class is a
// hashed name scoped to its own file and means nothing anywhere else.
//
// Owner 2026-08-01: red when they owe, green when they don't (including ₹0 and
// credit), an uncoloured em dash when we don't know.
function outstanding(r: RetailerRow): { text: string; cls: string } {
  const { state, text } = readBalance(r.outstanding_paise);
  const cls = state === "unknown" ? styles.amtNone : state === "clear" ? styles.amtClear : styles.amtOwed;
  return { text, cls };
}

// S11 — the retailers ledger. Desktop renders the shared table grammar; phone
// keeps its cards (owner-final). A row opens the DETAIL page (2026-08-01) —
// it no longer opens the edit modal in place.
//
// RetailerModal is deliberately NOT retired: it is the ONE editor, now reached
// from exactly two intentional places — Add on this page, Edit on the detail
// page — instead of from an accidental row tap. One editor means one copy of
// the save rules (blank ledger name -> shop name, rename safety, duplicate
// guard). Saving an unverified shop still verifies it (fixing the spelling IS
// the verification act), and activate/deactivate still lives inside it.
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
            <Glyph icon={MapPinPlus} />
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
        <>
          {/* DESKTOP. Navigation is a real <a> in the name cell PLUS a plain
              row click for the rest of the row.

              It was one <a> stretched over the whole row via
              `.rowLink::after` + `position: relative` on the <tr>. That is
              broken in Safari (REVIEWER flag 58, reproduced 2026-08-01):
              WebKit does not make a <tr> a containing block, and nothing above
              it is positioned either (.shell is fixed only on phone), so every
              row's overlay fell through to the INITIAL containing block — one
              viewport-sized box at the top of the document. All ~599 stacked
              there, the last in DOM order won every click, and the rows
              underneath got no hover at all.

              Do NOT re-fix that by adding `position: relative` to a wrapper:
              the overlays would simply all escape to that box instead.

              So the stretch is scoped to the name CELL, which positions
              reliably everywhere, and the rest of the row gets an onClick. The
              anchor still carries prefetch, keyboard focus, middle-click,
              open-in-new-tab and screen-reader semantics. The handler is safe
              here because there is NO onMouseEnter and no state — Orders'
              hover trail came from setSelectedIndex firing on hover, never
              from onClick.

              The badges move out of the name into a STATUS column, so names
              left-align instead of starting at a different x on every row. */}
          <table className={table.table}>
            <thead>
              <tr>
                <th>NAME</th>
                <th>AREA</th>
                <th>PHONE</th>
                <th className={table.numeric}>OUTSTANDING</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={`${table.clickable} ${!r.active ? styles.rowDeactivated : ""}`}
                  onClick={(e) => {
                    // The name cell owns a real <a>. Let it handle its own
                    // click — including cmd/ctrl/middle-click for a new tab —
                    // instead of navigating twice.
                    if ((e.target as HTMLElement).closest("a")) return;
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    // Don't navigate out from under someone copying a phone
                    // number: a drag-select inside a row ends with a click on
                    // it, so without this the office loses the selection and
                    // lands on the detail page instead.
                    if (window.getSelection()?.toString()) return;
                    router.push(`/dashboard/retailers/${r.id}`);
                  }}
                >
                  <td className={table.cellName}>
                    <Link href={`/dashboard/retailers/${r.id}`} className={styles.rowLink}>
                      {r.name}
                    </Link>
                  </td>
                  <td className={table.cellMeta}>{r.area || "—"}</td>
                  <td className={`${table.mono} ${table.cellMeta}`}>{r.phone || "—"}</td>
                  {/* The colour lives on a SPAN, not the <td>: `.table td`
                      sets its own `color` at (0,1,1), which a bare page-module
                      class on the cell would lose to. The span inherits
                      nothing that competes. */}
                  <td className={`${table.mono} ${table.numeric}`}>
                    <span className={outstanding(r).cls}>{outstanding(r).text}</span>
                  </td>
                  <td>
                    {r.active && !r.verified && <span className={styles.newBadge}>NEW</span>}
                    {isNotSynced(r) && <span className={styles.notSyncedBadge}>NOT SYNCED</span>}
                    {!r.active && <span className={styles.deactivatedBadge}>DEACTIVATED</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* PHONE — unchanged layout (owner-final), now a real <Link> instead
              of a div+onClick that opened the modal in place. */}
          <div className={styles.list}>
            {filtered.map((r) => {
              const needsVerification = r.active && !r.verified;
              const isDeactivated = !r.active;
              // Rendered only when there is something real to say. It used to
              // fall back to "No area/phone on file", which 604 of 623 shops
              // showed — a string on 97% of cards is texture, not information,
              // and the eye skipped it 604 times to find the 19 that matter.
              // Now a second line MEANS the shop has contact details.
              // Same rule RetailerList applies to its own line 2, so the three
              // retailer surfaces read the same way.
              const meta = [r.area, r.phone].filter(Boolean).join(" · ");
              return (
                <Link
                  key={r.id}
                  href={`/dashboard/retailers/${r.id}`}
                  className={`${styles.row} ${styles.rowClickable} ${isDeactivated ? styles.rowDeactivated : ""}`}
                >
                  <div className={styles.rowInfo}>
                    <p className={styles.rowName}>
                      {r.name}
                      {needsVerification && <span className={styles.newBadge}>NEW</span>}
                      {isNotSynced(r) && <span className={styles.notSyncedBadge}>NOT SYNCED</span>}
                      {isDeactivated && <span className={styles.deactivatedBadge}>DEACTIVATED</span>}
                    </p>
                    {meta && <p className={styles.rowMeta}>{meta}</p>}
                  </div>
                  {/* Right edge of the card, opposite the name — the same
                      place the Orders card puts its amount, so the two lists
                      scan the same way. */}
                  <span className={`${styles.rowAmount} ${outstanding(r).cls}`}>{outstanding(r).text}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* Phone FAB — the same entry point as the desktop button. */}
      <button type="button" className={`${fab.fab} ${fab.phoneOnly}`} onClick={() => setAdding(true)}>
        <Glyph icon={MapPinPlus} />
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

    </div>
  );
}
