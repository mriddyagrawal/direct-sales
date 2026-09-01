"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SalesmanFilter } from "@/components/orders/SalesmanFilter";
import { formatRupees, formatOrderTime, formatOrderTimestamp, formatHistoryDayHeader, istDateKey } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { voidDeposit } from "@/lib/deposit-rpcs";
import { createClient } from "@/lib/supabase/client";
import { fetchDepositsList, type DepositListRow, type DepositsScope } from "@/lib/queries/deposits";
import { depositNetPaise, describeDepositEdit } from "@/lib/deposit-fields";
import { useQuery } from "@tanstack/react-query";
import fab from "@/components/ui/fab.module.css";
import styles from "./DepositsView.module.css";

// The row shape + list query live in the shared builder (spec D12); the type
// is re-exported here so existing importers keep working.
export type { DepositListRow };

interface DepositsViewProps {
  // Cache-key scope (["deposits", scope], spec D4) — the server page
  // prefetches the same scope into a HydrationBoundary; this component then
  // owns the data via useQuery. Matches `role` today, but stays a separate
  // prop so the key contract is explicit at the call site.
  scope: DepositsScope;
  role: "salesman" | "staff";
  isAdmin?: boolean;
  // Who is looking. The edit affordance is own-rows-in-window for everyone
  // but the admin — including the ACCOUNTANT (owner 2026-09-01), whose own
  // fresh entries the server always permitted but the UI never surfaced.
  viewerId: string;
}

const METHOD_LABEL: Record<string, string> = { cash: "Cash", cheque: "Cheque", online: "Online" };
const METHODS = ["cash", "cheque", "online"] as const;

// Monday-start IST week key for a given IST date key ("YYYY-MM-DD").
function weekStartKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function weekEndKey(dateKey: string): string {
  const d = new Date(`${weekStartKey(dateKey)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// One deposit's audit trail, fetched only when its card is expanded (staff
// only — deposit_events RLS). Chronological: recorded → each edit's field
// diffs (describeDepositEdit) → void, each line stamped who + when.
interface TrailEvent {
  action: string;
  created_at: string;
  details: {
    before?: Parameters<typeof describeDepositEdit>[0];
    after?: Parameters<typeof describeDepositEdit>[1];
    reason?: string;
  } | null;
  profiles: { full_name: string } | null;
}

function EditTrail({ depositId }: { depositId: string }) {
  const { data: events, isError } = useQuery({
    queryKey: ["deposit-events", depositId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("deposit_events")
        .select("action, created_at, details, profiles!deposit_events_actor_id_fkey(full_name)")
        .eq("deposit_id", depositId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as TrailEvent[];
    },
  });
  if (isError) return <div className={styles.trail}>Couldn&apos;t load the history — try again.</div>;
  if (!events) return <div className={styles.trail}>…</div>;
  return (
    <div className={styles.trail}>
      {events.map((e, i) => {
        let text = "";
        if (e.action === "created") text = "recorded";
        else if (e.action === "voided") text = e.details?.reason ? `voided — ${e.details.reason}` : "voided";
        else if (e.action === "updated") {
          const changes = describeDepositEdit(e.details?.before ?? {}, e.details?.after ?? {});
          text = changes.length
            ? changes.map((c) => (c.to ? `${c.label} ${c.from} → ${c.to}` : `${c.label} ${c.from}`)).join(" · ")
            : "edited (no field change)";
        } else text = e.action;
        return (
          <p key={i} className={styles.trailLine}>
            <span className={styles.trailWho}>
              {formatOrderTimestamp(e.created_at, new Date())} · {e.profiles?.full_name ?? "—"}
            </span>{" "}
            {text}
          </p>
        );
      })}
    </div>
  );
}

function MethodChip({ method }: { method: string }) {
  const tone =
    method === "cash" ? styles.methodCash : method === "cheque" ? styles.methodCheque : styles.methodOnline;
  return <span className={`${styles.methodChip} ${tone}`}>{METHOD_LABEL[method] ?? method}</span>;
}

// Deposits — the salesman's personal collection ledger and the office's
// reconciliation view, one component (owner design 2026-07-19). SALESMAN
// (phone-first): hero = his running totals (Today · This week), day-grouped
// history, in-window rows tappable to edit, a New-deposit FAB. STAFF
// (responsive): hero = the chosen day's per-method + per-salesman totals
// (admin also week/month), desktop table ↔ mobile cards, a FAB too; the
// ADMIN gets per-row Edit / Void (void = struck + kept + reasoned — nothing
// is ever hard-deleted). Voided rows are struck + muted and excluded from
// every total, both roles.
export function DepositsView({ scope, role, isAdmin = false, viewerId }: DepositsViewProps) {
  const router = useRouter();
  // Spec D10/D13: render ONLY from the query cache — seeded by the server
  // render, corrected by background refetches (mount/focus/reconnect, D6) and
  // by mutation invalidations; `?? []` keeps a painted list painted if a
  // background refetch fails (never gate rendering on isError). The post-void
  // router.refresh() below keeps working: it re-renders the page and the
  // fresh dehydrated payload feeds this same cache (spec D2/D7).
  const { data: deposits = [] } = useQuery({
    queryKey: ["deposits", scope],
    queryFn: () => fetchDepositsList(createClient(), scope),
  });
  const [tick, setTick] = useState(nowMs);
  useEffect(() => {
    const t = setInterval(() => setTick(nowMs()), 30_000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => new Date(tick), [tick]);
  const todayKey = istDateKey(now);

  // ---- staff controls ----
  const [anchorKey, setAnchorKey] = useState(todayKey);
  const [range, setRange] = useState<"day" | "week" | "month">("day");
  const [salesmanFilter, setSalesmanFilter] = useState("all");

  // ---- edited-row trail (owner 2026-09-01): amber badge + chevron on rows
  // that carry an 'updated' event; tapping expands the audit trail in place.
  // Staff-only by construction — the events embed is RLS-empty for salesmen.
  const [trailOpenId, setTrailOpenId] = useState<string | null>(null);

  // ---- admin void sheet ----
  const [voidTarget, setVoidTarget] = useState<DepositListRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const isStaff = role === "staff";

  // Filter options derived from the rows themselves — everyone who has ever
  // recorded a deposit (incl. an office recorder), so the filter always
  // matches the data instead of a role-scoped profile list.
  const salesmen = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deposits) if (!map.has(d.salesman_id)) map.set(d.salesman_id, d.profiles?.full_name ?? "Unknown");
    return [...map.entries()]
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [deposits]);

  // Rows in the staff view's selected range (day/week/month around the anchor).
  const inRange = useMemo(() => {
    if (!isStaff) return deposits;
    return deposits.filter((d) => {
      const key = istDateKey(new Date(d.created_at));
      if (range === "day") return key === anchorKey;
      if (range === "week") return key >= weekStartKey(anchorKey) && key <= weekEndKey(anchorKey);
      return key.slice(0, 7) === anchorKey.slice(0, 7);
    });
  }, [isStaff, deposits, range, anchorKey]);

  // ACTIVE rows only feed totals — a voided deposit never counts anywhere.
  const activeInRange = useMemo(() => inRange.filter((d) => d.voided_at === null), [inRange]);

  // Reconciliation summaries (staff hero) — the whole range, deliberately
  // ignoring the salesman filter: the totals are the cash-count worksheet;
  // the filter only narrows the itemized list below.
  const methodTotals = useMemo(() => {
    const totals: Record<string, number> = { cash: 0, cheque: 0, online: 0 };
    for (const d of activeInRange) totals[d.method] = (totals[d.method] ?? 0) + depositNetPaise(d.amount_paise, d.discount_paise);
    return totals;
  }, [activeInRange]);
  const rangeTotal = activeInRange.reduce((s, d) => s + depositNetPaise(d.amount_paise, d.discount_paise), 0);
  const salesmanTotals = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    for (const d of activeInRange) {
      const cur = map.get(d.salesman_id) ?? { name: d.profiles?.full_name ?? "Unknown", total: 0 };
      cur.total += depositNetPaise(d.amount_paise, d.discount_paise);
      map.set(d.salesman_id, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [activeInRange]);

  // Salesman hero totals — his own ACTIVE money, today + this (Mon-start) week.
  const myToday = useMemo(
    () =>
      deposits.reduce(
        (s, d) =>
          d.voided_at === null && istDateKey(new Date(d.created_at)) === todayKey
            ? s + depositNetPaise(d.amount_paise, d.discount_paise)
            : s,
        0,
      ),
    [deposits, todayKey],
  );
  const myWeek = useMemo(() => {
    const start = weekStartKey(todayKey);
    return deposits.reduce(
      (s, d) =>
        d.voided_at === null && istDateKey(new Date(d.created_at)) >= start
          ? s + depositNetPaise(d.amount_paise, d.discount_paise)
          : s,
      0,
    );
  }, [deposits, todayKey]);

  // The list keeps voided rows VISIBLE (struck) — staff: range + salesman
  // filter; salesman: everything of his own.
  const listRows = isStaff
    ? salesmanFilter === "all"
      ? inRange
      : inRange.filter((d) => d.salesman_id === salesmanFilter)
    : deposits;

  // Day groups (mobile/salesman), newest day first (rows arrive created_at desc).
  const groups = useMemo(() => {
    const out: { key: string; header: string; rows: DepositListRow[] }[] = [];
    for (const d of listRows) {
      const key = istDateKey(new Date(d.created_at));
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(d);
      else out.push({ key, header: formatHistoryDayHeader(d.created_at, now), rows: [d] });
    }
    return out;
  }, [listRows, now]);

  function canEditRow(d: DepositListRow): boolean {
    if (d.voided_at !== null) return false;
    if (isAdmin) return true;
    return d.salesman_id === viewerId && tick < new Date(d.editable_until).getTime();
  }

  function openVoid(d: DepositListRow) {
    setVoidTarget(d);
    setVoidReason("");
    setVoidError(null);
  }

  async function handleVoid() {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      setVoidError("A reason is required to void a deposit.");
      return;
    }
    setVoiding(true);
    setVoidError(null);
    try {
      await voidDeposit(voidTarget.id, voidReason.trim());
      setVoidTarget(null);
      router.refresh();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "Could not void the deposit.");
    } finally {
      setVoiding(false);
    }
  }

  function editedBadge(d: DepositListRow) {
    if (!isStaff || !d.deposit_events?.some((e) => e.action === "updated")) return null;
    const open = trailOpenId === d.id;
    return (
      <button
        type="button"
        className={styles.editedBadge}
        aria-expanded={open}
        onClick={(e) => {
          // rows can be Links (admin edit) — the badge must never navigate
          e.preventDefault();
          e.stopPropagation();
          setTrailOpenId(open ? null : d.id);
        }}
      >
        <Glyph icon={TriangleAlert} size={12} />
        edited
        <span className={`${styles.badgeChevron} ${open ? styles.badgeChevronOpen : ""}`} aria-hidden />
      </button>
    );
  }

  function renderCardRow(d: DepositListRow) {
    const voided = d.voided_at !== null;
    const editable = canEditRow(d);
    const net = depositNetPaise(d.amount_paise, d.discount_paise);
    const inner = (
      <>
        <div className={styles.rowMain}>
          <span className={`${styles.rowRetailer} ${voided ? styles.voided : ""}`}>
            {d.retailers?.name ?? "Unknown retailer"}
          </span>
          <span className={styles.rowMeta}>
            {/* The row's NAME leads the meta line (owner 2026-09-01) — the
                shared reference for a phone call between the desktop and a
                shop. Kept apart from the paper receipt no. so the two numbers
                never read as one. */}
            <span className={styles.rowRef}>{d.deposit_ref}</span>
            {" · "}
            {isStaff && d.profiles?.full_name ? `${d.profiles.full_name} · ` : ""}
            <MethodChip method={d.method} />
            {d.receipt_ref ? ` · receipt ${d.receipt_ref}` : ""}
            {d.note ? ` · ${d.note}` : ""}
            {voided && d.void_reason ? ` · voided: ${d.void_reason}` : voided ? " · voided" : ""}
          </span>
          {editedBadge(d)}
        </div>
        <div className={styles.rowSide}>
          {/* NET prominent, GROSS struck beside it (owner 2026-08-31) — the
              row leads with the money that changed hands; the struck figure
              is what came off the balance. Voided rows keep the plain single
              figure: two different strikethroughs on one line read as noise. */}
          <span className={`${styles.rowAmount} ${voided ? styles.voided : ""}`}>{formatRupees(net)}</span>
          {!voided && d.discount_paise > 0 && (
            <span className={styles.rowGross}>
              <s>{formatRupees(d.amount_paise)}</s> − {formatRupees(d.discount_paise)} disc
            </span>
          )}
          <span className={styles.rowTime}>{formatOrderTime(d.created_at)}</span>
          {editable && (
            <span className={styles.editChip}>
              <Glyph icon={Pencil} size={11} /> Edit
            </span>
          )}
        </div>
      </>
    );
    return (
      <Fragment key={d.id}>
        {editable ? (
          <Link href={`/deposits/new?edit=${d.id}`} className={`${styles.row} ${styles.rowTappable}`}>
            {inner}
          </Link>
        ) : (
          <div className={styles.row}>{inner}</div>
        )}
        {trailOpenId === d.id && <EditTrail depositId={d.id} />}
      </Fragment>
    );
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Deposits</h1>

      {/* ---- HERO ---- */}
      {role === "salesman" ? (
        <div className={styles.heroBand}>
          <div className={styles.heroStat}>
            <span className={styles.heroLabel}>TODAY</span>
            <span className={styles.heroValue}>{formatRupees(myToday)}</span>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroLabel}>THIS WEEK</span>
            <span className={`${styles.heroValue} ${styles.heroValueBig}`}>{formatRupees(myWeek)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.controls}>
            <input
              type="date"
              className={styles.dayPicker}
              value={anchorKey}
              max={todayKey}
              onChange={(e) => e.target.value && setAnchorKey(e.target.value)}
              aria-label="Day"
            />
            {isAdmin && (
              <div className={styles.rangeSeg} role="group" aria-label="Range">
                {(["day", "week", "month"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`${styles.rangeBtn} ${range === r ? styles.rangeBtnActive : ""}`}
                    onClick={() => setRange(r)}
                  >
                    {r === "day" ? "Day" : r === "week" ? "Week" : "Month"}
                  </button>
                ))}
              </div>
            )}
            <SalesmanFilter salesmen={salesmen} value={salesmanFilter} onChange={setSalesmanFilter} />
          </div>

          {/* Reconciliation hero: cash to count · cheques to bank · online to
              verify, then what each salesman's hand-in should total. */}
          <div className={styles.reconGrid}>
            <div className={styles.reconCard}>
              <span className={styles.reconLabel}>BY METHOD</span>
              {METHODS.map((m) => (
                <div key={m} className={styles.reconLine}>
                  <MethodChip method={m} />
                  <span className={styles.reconAmount}>{formatRupees(methodTotals[m] ?? 0)}</span>
                </div>
              ))}
              <div className={`${styles.reconLine} ${styles.reconTotal}`}>
                <span>Total</span>
                <span className={styles.reconAmount}>{formatRupees(rangeTotal)}</span>
              </div>
            </div>
            <div className={styles.reconCard}>
              <span className={styles.reconLabel}>BY SALESMAN</span>
              {salesmanTotals.length === 0 ? (
                <span className={styles.reconEmpty}>—</span>
              ) : (
                salesmanTotals.map((s) => (
                  <div key={s.name} className={styles.reconLine}>
                    <span>{s.name}</span>
                    <span className={styles.reconAmount}>{formatRupees(s.total)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* ---- LIST ---- */}
      {listRows.length === 0 ? (
        <div className={styles.empty}>
          {role === "salesman" ? (
            <>
              <p className={styles.emptyLead}>No collections yet</p>
              <p className={styles.emptyHint}>Tap ＋ to record the first one.</p>
            </>
          ) : (
            <p className={styles.emptyLead}>No collections for this {range}.</p>
          )}
        </div>
      ) : (
        <>
          {/* Desktop (staff): a real table — mirrors OrdersView's split. */}
          {isStaff && (
            <table className={styles.table}>
              <thead>
                <tr>
                  {/* REF leads like a statement's voucher-number column (owner
                      2026-09-01) — and sits three columns from RECEIPT so the
                      app's identity and the paper number never blur. */}
                  <th>REF</th>
                  <th>SALESMAN</th>
                  <th>RETAILER</th>
                  <th>RECEIPT</th>
                  <th className={styles.numeric}>AMOUNT</th>
                  <th>METHOD</th>
                  <th>TIME</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listRows.map((d) => {
                  const voided = d.voided_at !== null;
                  const net = depositNetPaise(d.amount_paise, d.discount_paise);
                  return (
                    <Fragment key={d.id}>
                    <tr className={voided ? styles.rowVoided : ""}>
                      <td className={`${styles.mono} ${styles.refCell}`}>{d.deposit_ref}</td>
                      <td>{d.profiles?.full_name ?? "Unknown"}</td>
                      <td className={voided ? styles.voided : ""}>
                        {d.retailers?.name ?? "Unknown retailer"}
                        {editedBadge(d)}
                        {voided && d.void_reason && <span className={styles.voidNote}>voided: {d.void_reason}</span>}
                      </td>
                      <td className={`${styles.mono} ${voided ? styles.voided : ""}`}>{d.receipt_ref ?? "—"}</td>
                      {/* Note sits UNDER the amount (owner 2026-07-19) — the
                          cheque no. / UPI ref reads with the money it explains.
                          NET leads; on a discounted row the struck GROSS and
                          the discount sit beneath it — dad books TWO Tally
                          lines from this cell (receipt + discount), so both
                          figures stay legible, never merged. */}
                      <td className={`${styles.mono} ${styles.numeric} ${voided ? styles.voided : ""}`}>
                        {formatRupees(net)}
                        {!voided && d.discount_paise > 0 && (
                          <span className={styles.tableNote}>
                            <s>{formatRupees(d.amount_paise)}</s> − {formatRupees(d.discount_paise)} disc
                          </span>
                        )}
                        {!voided && d.note && <span className={styles.tableNote}>{d.note}</span>}
                      </td>
                      <td>
                        <MethodChip method={d.method} />
                      </td>
                      <td className={styles.mono}>{formatOrderTimestamp(d.created_at, now)}</td>
                      <td className={styles.actionsCell}>
                        {canEditRow(d) && (
                          <Link href={`/deposits/new?edit=${d.id}`} className={styles.actionLink}>
                            Edit
                          </Link>
                        )}
                        {isAdmin && !voided && (
                          <button type="button" className={styles.actionVoid} onClick={() => openVoid(d)}>
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                    {trailOpenId === d.id && (
                      <tr className={styles.trailTableRow}>
                        <td colSpan={8}>
                          <EditTrail depositId={d.id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Mobile (staff) / always (salesman): day-grouped stacked rows. */}
          <div className={isStaff ? styles.cardsMobile : undefined}>
            {groups.map((g) => (
              <section key={g.key} className={styles.group}>
                <p className={styles.groupHeader}>{g.header}</p>
                {g.rows.map(renderCardRow)}
              </section>
            ))}
          </div>
        </>
      )}

      {/* Everyone who can record gets the FAB — salesman page AND office view. */}
      <Link href="/deposits/new" className={`${fab.fab} ${fab.desktopCorner}`}>
        <Glyph icon={Plus} />
        New deposit
      </Link>

      {/* Admin void — reason required (mirrors cancel-order's sheet). */}
      {voidTarget && (
        <BottomSheet onClose={() => setVoidTarget(null)}>
          <p className={styles.confirmTitle}>Void {voidTarget.deposit_ref}?</p>
          <p className={styles.confirmBody}>
            {voidTarget.retailers?.name} · {formatRupees(depositNetPaise(voidTarget.amount_paise, voidTarget.discount_paise))} —
            the row stays, struck out and excluded from totals.
          </p>
          <label className={styles.reasonLabel}>REASON (required)</label>
          <textarea
            className={styles.reasonInput}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="e.g. duplicate entry"
          />
          {voidError && <p className={styles.error}>{voidError}</p>}
          <div className={styles.confirmActions}>
            <Button variant="secondary" onClick={() => setVoidTarget(null)}>
              Keep it
            </Button>
            <Button variant="destructive-filled" onClick={handleVoid} loading={voiding}>
              Void deposit
            </Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
