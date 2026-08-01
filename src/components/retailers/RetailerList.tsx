"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { readBalance } from "@/lib/balance";
import type { RetailerRow } from "@/lib/queries/retailers";
import styles from "./RetailerList.module.css";

// THE retailer list — the search field, the RECENT/ALL SHOPS sectioning and the
// rows, shared by every screen that lists shops for a salesman.
//
// Extracted from PickRetailer rather than written fresh: that predicate and
// that sectioning are the agreed behaviour and already work. Sharing only the
// ROW would have left the search predicate duplicated, and "why does search
// behave differently on the two screens?" is a bug nobody files and everybody
// notices.
//
// What deliberately stays OUT: the page shell (a FlowHeader on the picker, a
// TopStrip + tab bar on the Retailers tab) and the whole quick-add flow. Pull
// those in and this becomes a switchboard that renders one shell or the other.
// The picker's "no match → add it as a new shop" empty state is picker-only for
// the same reason, so it arrives through a slot instead of teaching this
// component about quick-add.

// The tap is the ONE thing each screen owns: the picker advances a flow, the
// tab navigates. One or the other, never both — expressed as a union so the
// compiler enforces it rather than a comment asking nicely.
type TapBehaviour =
  | { onSelect: (retailer: RetailerRow) => void; href?: never }
  | { href: (retailer: RetailerRow) => string; onSelect?: never };

type RetailerListProps = {
  retailers: RetailerRow[];
  // Shown first, in the order given (most recent first) — not re-sorted.
  recentRetailerIds?: string[];
  // Rendered instead of the sections when a SEARCH returns nothing. Receives
  // the live query so a caller can offer "add <query> as a new shop".
  emptyState?: (query: string) => React.ReactNode;
} & TapBehaviour;

export function RetailerList(props: RetailerListProps) {
  const { retailers, recentRetailerIds = [], emptyState } = props;
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  // Unchanged from the picker: name + area, lowercased, substring. The area
  // still MATCHES even though it now renders on line 2 rather than at the right
  // of the row.
  const matches = (r: RetailerRow) =>
    q === "" || r.name.toLowerCase().includes(q) || (r.area ?? "").toLowerCase().includes(q);

  const byId = useMemo(() => new Map(retailers.map((r) => [r.id, r])), [retailers]);
  const recentIdSet = new Set(recentRetailerIds);
  const recent = recentRetailerIds.map((id) => byId.get(id)).filter((r): r is RetailerRow => !!r && matches(r));
  const all = retailers
    .filter((r) => !recentIdSet.has(r.id) && matches(r))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Note `q !== ""`: an empty LIST with no query renders nothing rather than an
  // empty state, exactly as the picker has always behaved.
  const noResults = q !== "" && recent.length === 0 && all.length === 0;

  function renderRow(r: RetailerRow) {
    const content = <RowContent retailer={r} />;
    return props.href ? (
      <Link key={r.id} href={props.href(r)} className={styles.row}>
        {content}
      </Link>
    ) : (
      <button key={r.id} type="button" className={styles.row} onClick={() => props.onSelect?.(r)}>
        {content}
      </button>
    );
  }

  return (
    <>
      <Field
        label="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Shop name or area"
      />

      {noResults ? (
        (emptyState?.(query) ?? <p className={styles.empty}>No shops match &quot;{query}&quot;.</p>)
      ) : (
        <>
          {recent.length > 0 && (
            <section>
              <p className={styles.sectionLabel}>RECENT</p>
              {recent.map(renderRow)}
            </section>
          )}
          {all.length > 0 && (
            <section>
              <p className={styles.sectionLabel}>ALL SHOPS</p>
              {all.map(renderRow)}
            </section>
          )}
        </>
      )}
    </>
  );
}

// Name + balance on line 1; area and NEW drop to line 2.
function RowContent({ retailer }: { retailer: RetailerRow }) {
  const balance = readBalance(retailer.outstanding_paise);
  const amountClass =
    balance.state === "unknown" ? styles.amtNone : balance.state === "clear" ? styles.amtClear : styles.amtOwed;
  // `area || !verified`, NOT just `area`: a quick-added shop typically has no
  // area, and keying line 2 on the area alone would silently drop its NEW badge.
  const hasLine2 = Boolean(retailer.area) || !retailer.verified;

  return (
    <>
      <span className={styles.body}>
        <span className={styles.name}>{retailer.name}</span>
        {hasLine2 && (
          <span className={styles.meta}>
            {retailer.area && <span className={styles.area}>{retailer.area}</span>}
            {!retailer.verified && <span className={styles.newTag}>NEW</span>}
          </span>
        )}
      </span>
      <span className={`${styles.amount} ${amountClass}`}>{balance.text}</span>
    </>
  );
}
