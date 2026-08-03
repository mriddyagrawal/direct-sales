"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil } from "lucide-react";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { StatusTag } from "@/components/ui/StatusTag";
// The editor stays where the queue that also opens it lives. It is staff-only
// by RLS (retailers_staff_update is accountant/admin) and by this component —
// the salesman lens never renders it — so it belongs with the dashboard, not
// in shared components. Same cross-folder shape as scan/[id] reaching for
// godown's PickScreen.
import { RetailerModal } from "@/app/dashboard/retailers/RetailerModal";
import type { RetailerRow } from "@/lib/queries/retailers";
import {
  fetchRetailerLedger,
  ledgerSinceDate,
  openingBalancePaise,
  LEDGER_SINCE_DEFAULT,
  LEDGER_SINCE_PRESETS,
  type LedgerSince,
} from "@/lib/queries/ledger";
import { createClient } from "@/lib/supabase/client";
import { readBalance, ledgerText } from "@/lib/balance";
import { formatOrderTimestamp, formatRupees, formatShortDate } from "@/lib/format";
import { nowMs } from "@/lib/cart";
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
  const now = new Date(nowMs());

  // The statement window. A START DATE only, never a from/to range: the proof
  // at the bottom is only the CURRENT outstanding if the window ends today, so
  // a closed range would make the page state a figure it cannot support.
  const [since, setSince] = useState<LedgerSince>(LEDGER_SINCE_DEFAULT);

  // The ledger, from the same cache the page's server render seeded. The PRESET
  // is the query key, not the date, so the server and the client agree even if
  // the request crosses midnight IST between them.
  //
  // keepPreviousData: without it, tapping a chip changes the key, `data` goes
  // undefined for the round trip, and the statement flashes its empty state —
  // "No entries since …" — on a shop that has plenty. The old window's rows
  // stay put instead, dimmed by .statementBusy, which also stops the opening
  // balance flickering through a wrong value: it is DERIVED from the rows on
  // screen, so while they are the previous window's it does not match the label
  // above them. Dimming says "updating" for the ~200ms that lasts.
  const { data: entries = [], isFetching } = useQuery({
    queryKey: ["ledger", retailer.id, since],
    queryFn: () => fetchRetailerLedger(createClient(), retailer.id, ledgerSinceDate(since)),
    placeholderData: keepPreviousData,
  });

  const balance = readBalance(retailer.outstanding_paise);
  const balanceClass =
    balance.state === "unknown" ? styles.amtNone : balance.state === "clear" ? styles.amtClear : styles.amtOwed;
  const notSynced = retailer.outstanding_paise === null;
  const sinceIso = ledgerSinceDate(since);
  const sinceLabel = sinceIso ? formatShortDate(sinceIso) : null;

  // Opening balance: what was owed BEFORE this window. Rendered only when it is
  // non-zero — 113 of 406 shops reconcile on their own and the row would say
  // nothing, so its ABSENCE is the signal — and only when there are entries,
  // because with none it is arithmetically identical to the closing figure and
  // would print the same number twice for no reason.
  const opening = openingBalancePaise(retailer.outstanding_paise, entries);
  const showOpening = opening !== null && opening !== 0 && entries.length > 0;

  // Area · phone, as ONE line, absent rather than blank when there is nothing —
  // 582 of 600 shops have no area at all, so a fact table was three rows of
  // furniture for a field almost nobody has.
  const contact = [retailer.area, retailer.phone].filter(Boolean);

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
            land somewhere real. His was `/` only because the salesman had no
            retailers list; that premise died when /retailers shipped, so it is
            the list that contains this shop now. Narrow change on purpose:
            back has been CONTEXTUAL since 28a9303, so the fallback is reached
            only on a COLD load (an empty nav mirror — a link opened from
            WhatsApp). Arriving from a row, or from the shop name on order
            detail, still returns to where he came from via the mirror.
            Chrome comes from the SHARED back stylesheet — identical glyph,
            size and placement to order detail (owner 2026-08-01). */}
        <BackLink contextual fallback={isStaff ? "/dashboard/retailers" : "/retailers"} className={back.link}>
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
        <div className={styles.identity}>
          <h1 className={styles.title}>{retailer.name}</h1>
          {contact.length > 0 && (
            <p className={styles.contact}>
              {retailer.area && <span>{retailer.area}</span>}
              {retailer.area && retailer.phone && <span aria-hidden>·</span>}
              {/* The one action on a read-only page. */}
              {retailer.phone && (
                <a className={styles.phone} href={`tel:${retailer.phone}`}>
                  {retailer.phone}
                </a>
              )}
            </p>
          )}
          {/* The Tally ledger name earns its place on an UNSYNCED shop and
              nowhere else: it is identical to the shop name on 596 of 599, so
              everywhere else it is noise, but on a shop that matched nothing it
              is the diagnosis. Staff-only, because linking it is an edit. */}
          {isStaff && notSynced && (
            <p className={styles.diagnosis}>Tally ledger: {retailer.tally_ledger_name || "— not linked —"}</p>
          )}
        </div>
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

      {/* THE CLAIM. The balance is stated here and PROVED at the bottom of the
          statement — the same figure twice, with the entries between as the
          working. That repetition is the page's argument, which is why the
          closing total gets the 2px ink rule rather than being one more row. */}
      <div className={styles.claim}>
        <p className={`${styles.claimFigure} ${balanceClass} ${notSynced ? styles.claimUnknown : ""}`}>
          {notSynced ? "Not in the last sync" : ledgerText(balance)}
        </p>
        <p className={styles.asOf}>
          {notSynced
            ? "no Tally ledger matched this shop"
            : retailer.balance_as_of
              ? `Tally, as of ${formatOrderTimestamp(retailer.balance_as_of, now)}`
              : "Tally"}
        </p>
      </div>

      <section className={styles.statement}>
        <div className={styles.statementHead}>
          <span>STATEMENT</span>
          {!notSynced && (
            <span className={styles.window}>{sinceLabel ? `since ${sinceLabel} · to today` : "all entries"}</span>
          )}
        </div>

        {/* Presets, not a date picker. Every one of them ends TODAY — see the
            comment on the `since` state. Hidden on an unsynced shop, where
            there is nothing to filter and the chips would only offer four ways
            to see the same empty statement. */}
        {!notSynced && (
          <div className={styles.sinceRow}>
            {LEDGER_SINCE_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`${styles.sinceChip} ${p.value === since ? styles.sinceChipOn : ""}`}
                onClick={() => setSince(p.value)}
                aria-pressed={p.value === since}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className={isFetching ? styles.statementBusy : undefined}>
        {entries.length === 0 ? (
          <p className={styles.empty}>
            {notSynced
              ? "Entries appear once a Tally ledger is linked to this shop."
              : sinceLabel
                ? `No entries since ${sinceLabel}.`
                : "No entries yet."}
          </p>
        ) : (
          <>
            {entries.map((e) => {
              // Sign and colour are the ONLY direction signal on the phone,
              // because the voucher type is Tally's verbatim string and no
              // longer says "Receipt" or "Bill". Desktop gets real Debit and
              // Credit columns instead (step 4).
              const isCredit = e.credit_paise > 0;
              const amount = isCredit ? e.credit_paise : e.debit_paise;
              return (
                <div key={e.id} className={styles.entry}>
                  <div className={styles.entryLeft}>
                    <p className={styles.entryDate}>{formatShortDate(e.entry_date)}</p>
                    <p className={styles.entryType}>
                      {e.voucher_type}
                      {e.voucher_no && <span className={styles.voucherNo}> {e.voucher_no}</span>}
                    </p>
                  </div>
                  <p className={`${styles.entryAmount} ${isCredit ? styles.amtClear : ""}`}>
                    {isCredit ? "−" : ""}
                    {formatRupees(amount)}
                  </p>
                </div>
              );
            })}
            {/* Last in the list because it is the OLDEST thing on it — the
                entries run newest-first, so "what they owed before all this"
                belongs under them. */}
            {showOpening && (
              <div className={styles.opening}>
                <span>Balance before {sinceLabel}</span>
                <span className={styles.openingValue}>{formatRupees(opening)}</span>
              </div>
            )}
          </>
        )}
        </div>

        {/* THE PROOF. Same figure as the claim above; the 2px ink rule is the
            app's existing "authoritative" device and marks this as a QED rather
            than another row. Hidden on an unsynced shop, where there is no
            figure to prove. */}
        {!notSynced && (
          <div className={styles.qed}>
            <span className={styles.qedLabel}>OUTSTANDING</span>
            <span className={`${styles.qedValue} ${balanceClass}`}>{balance.text}</span>
          </div>
        )}
      </section>

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
