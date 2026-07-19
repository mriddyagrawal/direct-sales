"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SalesmanFilter } from "@/components/orders/SalesmanFilter";
import { formatRupees, formatOrderTime, formatOrderTimestamp, formatHistoryDayHeader, istDateKey } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { voidDeposit } from "@/lib/deposit-rpcs";
import styles from "./DepositsView.module.css";

// One row off the deposits query (retailer + salesman names embedded).
export interface DepositListRow {
  id: string;
  deposit_ref: string;
  amount_paise: number;
  method: string;
  note: string | null;
  created_at: string;
  editable_until: string;
  salesman_id: string;
  voided_at: string | null;
  void_reason: string | null;
  retailers: { name: string } | null;
  profiles: { full_name: string } | null;
}

interface DepositsViewProps {
  deposits: DepositListRow[];
  role: "salesman" | "staff";
  isAdmin?: boolean;
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
export function DepositsView({ deposits, role, isAdmin = false }: DepositsViewProps) {
  const router = useRouter();
  const [tick] = useState(nowMs);
  const now = useMemo(() => new Date(tick), [tick]);
  const todayKey = istDateKey(now);

  // ---- staff controls ----
  const [anchorKey, setAnchorKey] = useState(todayKey);
  const [range, setRange] = useState<"day" | "week" | "month">("day");
  const [salesmanFilter, setSalesmanFilter] = useState("all");

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
    for (const d of activeInRange) totals[d.method] = (totals[d.method] ?? 0) + d.amount_paise;
    return totals;
  }, [activeInRange]);
  const rangeTotal = activeInRange.reduce((s, d) => s + d.amount_paise, 0);
  const salesmanTotals = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    for (const d of activeInRange) {
      const cur = map.get(d.salesman_id) ?? { name: d.profiles?.full_name ?? "Unknown", total: 0 };
      cur.total += d.amount_paise;
      map.set(d.salesman_id, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [activeInRange]);

  // Salesman hero totals — his own ACTIVE money, today + this (Mon-start) week.
  const myToday = useMemo(
    () =>
      deposits.reduce(
        (s, d) =>
          d.voided_at === null && istDateKey(new Date(d.created_at)) === todayKey ? s + d.amount_paise : s,
        0,
      ),
    [deposits, todayKey],
  );
  const myWeek = useMemo(() => {
    const start = weekStartKey(todayKey);
    return deposits.reduce(
      (s, d) => (d.voided_at === null && istDateKey(new Date(d.created_at)) >= start ? s + d.amount_paise : s),
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
    return role === "salesman" ? tick < new Date(d.editable_until).getTime() : isAdmin;
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

  function renderCardRow(d: DepositListRow) {
    const voided = d.voided_at !== null;
    const editable = canEditRow(d);
    const inner = (
      <>
        <div className={styles.rowMain}>
          <span className={`${styles.rowRetailer} ${voided ? styles.voided : ""}`}>
            {d.retailers?.name ?? "Unknown retailer"}
          </span>
          <span className={styles.rowMeta}>
            {isStaff && d.profiles?.full_name ? `${d.profiles.full_name} · ` : ""}
            <MethodChip method={d.method} />
            {d.note ? ` · ${d.note}` : ""}
            {voided && d.void_reason ? ` · voided: ${d.void_reason}` : voided ? " · voided" : ""}
          </span>
        </div>
        <div className={styles.rowSide}>
          <span className={`${styles.rowAmount} ${voided ? styles.voided : ""}`}>{formatRupees(d.amount_paise)}</span>
          <span className={styles.rowTime}>
            {formatOrderTime(d.created_at)}
            {editable ? " · edit" : ""}
          </span>
        </div>
      </>
    );
    return editable ? (
      <Link key={d.id} href={`/deposits/new?edit=${d.id}`} className={`${styles.row} ${styles.rowTappable}`}>
        {inner}
      </Link>
    ) : (
      <div key={d.id} className={styles.row}>
        {inner}
      </div>
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
                  <th>SALESMAN</th>
                  <th>RETAILER</th>
                  <th className={styles.numeric}>AMOUNT</th>
                  <th>METHOD</th>
                  <th>TIME</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {listRows.map((d) => {
                  const voided = d.voided_at !== null;
                  return (
                    <tr key={d.id} className={voided ? styles.rowVoided : ""}>
                      <td>{d.profiles?.full_name ?? "Unknown"}</td>
                      <td className={voided ? styles.voided : ""}>
                        {d.retailers?.name ?? "Unknown retailer"}
                        {voided && d.void_reason && <span className={styles.voidNote}>voided: {d.void_reason}</span>}
                      </td>
                      {/* Note sits UNDER the amount (owner 2026-07-19) — the
                          cheque no. / UPI ref reads with the money it explains. */}
                      <td className={`${styles.mono} ${styles.numeric} ${voided ? styles.voided : ""}`}>
                        {formatRupees(d.amount_paise)}
                        {!voided && d.note && <span className={styles.tableNote}>{d.note}</span>}
                      </td>
                      <td>
                        <MethodChip method={d.method} />
                      </td>
                      <td className={styles.mono}>{formatOrderTimestamp(d.created_at, now)}</td>
                      {isAdmin && (
                        <td className={styles.actionsCell}>
                          {!voided && (
                            <>
                              <Link href={`/deposits/new?edit=${d.id}`} className={styles.actionLink}>
                                Edit
                              </Link>
                              <button type="button" className={styles.actionVoid} onClick={() => openVoid(d)}>
                                Void
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
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
      <Link href="/deposits/new" className={styles.fab}>
        <Glyph icon={Plus} />
        New deposit
      </Link>

      {/* Admin void — reason required (mirrors cancel-order's sheet). */}
      {voidTarget && (
        <BottomSheet onClose={() => setVoidTarget(null)}>
          <p className={styles.confirmTitle}>Void {voidTarget.deposit_ref}?</p>
          <p className={styles.confirmBody}>
            {voidTarget.retailers?.name} · {formatRupees(voidTarget.amount_paise)} — the row stays, struck out and
            excluded from totals.
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
