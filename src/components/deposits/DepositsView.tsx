"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { createClient } from "@/lib/supabase/client";
import { fetchDepositsList, type DepositListRow, type DepositsScope } from "@/lib/queries/deposits";
import { depositNetPaise } from "@/lib/deposit-fields";
import { DepositDetail, depositMsgState, type MsgState } from "./DepositDetail";
import { TickSingle, TickDouble, TickCross } from "./MsgTicks";
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
  // Who is looking — void is own-rows-in-window for everyone but the admin.
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

function MethodChip({ method }: { method: string }) {
  const tone =
    method === "cash" ? styles.methodCash : method === "cheque" ? styles.methodCheque : styles.methodOnline;
  return <span className={`${styles.methodChip} ${tone}`}>{METHOD_LABEL[method] ?? method}</span>;
}

// The row's message state (redesign 2026-09-03) — the WhatsApp mental model:
// grey tick sent, grey DOUBLE tick delivered (count carries the difference,
// colour stays out of it), red cross failed, amber REPLY chip (the tripwire
// outranks everything). Owner-supplied SVG marks (MsgTicks). Voided rows
// show VOIDED instead; legacy rows with no events show nothing.
function MsgGlyph({ state }: { state: MsgState }) {
  switch (state.kind) {
    case "reply":
      return <span className={styles.replyChip}>{state.count > 1 ? `${state.count} REPLIES` : "1 REPLY"}</span>;
    case "read":
      return (
        <span className={`${styles.msg} ${styles.msgRead}`} title="Read">
          <TickDouble />
        </span>
      );
    case "delivered":
      return (
        <span className={`${styles.msg} ${styles.msgDelivered}`} title="Delivered">
          <TickDouble />
        </span>
      );
    case "sent":
      return (
        <span className={`${styles.msg} ${styles.msgSent}`} title="Sent — not yet delivered">
          <TickSingle />
        </span>
      );
    case "failed":
      return (
        <span className={`${styles.msg} ${styles.msgFailed}`} title="Message failed">
          <TickCross size={12} />
        </span>
      );
    default:
      return null;
  }
}

// Deposits — the salesman's personal collection ledger and the office's
// reconciliation view, one component (owner redesign 2026-09-03). The row is
// FOUR THINGS AND A COLOUR — shop, net, time, message state — and everything
// else lives INSIDE: tap a row (phone: bottom sheet, desktop: the row expands)
// for the money block, both receipt numbers, the outstanding snapshot, the
// full trail timeline, and the void action. Staff additionally get a
// NEEDS-ATTENTION strip (replies + failed receipts) above the list — the
// anti-fraud surface. Voided rows stay visible, struck, excluded from totals.
export function DepositsView({ scope, role, isAdmin = false, viewerId }: DepositsViewProps) {
  const router = useRouter();
  // Spec D10/D13: render ONLY from the query cache — seeded by the server
  // render, corrected by background refetches; `?? []` keeps a painted list
  // painted if a background refetch fails.
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

  // ---- the open deposit (phone: sheet, desktop: expanded row) ----
  const [openId, setOpenId] = useState<string | null>(null);

  // ---- void sheet (opened from inside the detail) ----
  const [voidTarget, setVoidTarget] = useState<DepositListRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const isStaff = role === "staff";

  // Filter options derived from the rows themselves — everyone who has ever
  // recorded a deposit, so the filter always matches the data.
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

  // Day groups (mobile/salesman), newest day first — each band carries its
  // day's ACTIVE net total (redesign 2026-09-03).
  const groups = useMemo(() => {
    const out: { key: string; header: string; total: number; rows: DepositListRow[] }[] = [];
    for (const d of listRows) {
      const key = istDateKey(new Date(d.created_at));
      const net = d.voided_at === null ? depositNetPaise(d.amount_paise, d.discount_paise) : 0;
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.rows.push(d);
        last.total += net;
      } else out.push({ key, header: formatHistoryDayHeader(d.created_at, now), total: net, rows: [d] });
    }
    return out;
  }, [listRows, now]);

  // NEEDS ATTENTION (staff): replies + failed receipts in the visible range —
  // the two signals worth interrupting the owner for, above everything.
  const attention = useMemo(() => {
    if (!isStaff) return [];
    const out: { d: DepositListRow; kind: "reply" | "failed" }[] = [];
    for (const d of inRange) {
      const state = depositMsgState(d.deposit_events ?? []);
      if (state.kind === "reply") out.push({ d, kind: "reply" });
      else if (state.kind === "failed" && d.voided_at === null) out.push({ d, kind: "failed" });
    }
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "reply" ? -1 : 1)).slice(0, 6);
  }, [isStaff, inRange]);

  // Void-only world (owner 2026-09-02): the creator inside the 30-minute
  // window, an admin anytime — same gate the RPC enforces.
  function voidStateFor(d: DepositListRow): { kind: "window"; until: string } | { kind: "admin" } | { kind: "closed" } {
    if (isAdmin) return { kind: "admin" };
    const msLeft = new Date(d.editable_until).getTime() - tick;
    if (d.salesman_id === viewerId && msLeft > 0) return { kind: "window", until: d.editable_until };
    return { kind: "closed" };
  }

  function openVoid(d: DepositListRow) {
    setOpenId(null);
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

  const openRow = openId === null ? null : (listRows.find((d) => d.id === openId) ?? null);

  // THE ROW (redesign 2026-09-03): shop · net · time · message state — a
  // teaser, like an order row. Everything else is inside; the whole card is
  // the tap target. Replies flare the left edge amber.
  function renderCardRow(d: DepositListRow) {
    const voided = d.voided_at !== null;
    const state = depositMsgState(d.deposit_events ?? []);
    const net = depositNetPaise(d.amount_paise, d.discount_paise);
    return (
      <button
        type="button"
        key={d.id}
        className={`${styles.card} ${state.kind === "reply" ? styles.cardReply : ""}`}
        onClick={() => setOpenId(d.id)}
      >
        <span className={styles.rowTop}>
          <span className={`${styles.shop} ${voided ? styles.voided : ""}`}>
            {d.retailers?.name ?? "Unknown retailer"}
          </span>
          {voided ? <span className={styles.voidTag}>VOIDED</span> : <MsgGlyph state={state} />}
        </span>
        <span className={styles.rowBottom}>
          <span className={`${styles.net} ${voided ? styles.voided : ""}`}>{formatRupees(net)}</span>
          <span className={styles.rowRight}>
            {isStaff && d.profiles?.full_name && <span className={styles.by}>{d.profiles.full_name}</span>}
            <span className={styles.time}>{formatOrderTime(d.created_at)}</span>
          </span>
        </span>
      </button>
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

          {/* The anti-fraud surface: replies + failed receipts, above
              everything — tapping opens that deposit's inside. */}
          {attention.length > 0 && (
            <div className={styles.attn}>
              <p className={styles.attnHead}>NEEDS ATTENTION · {attention.length}</p>
              {attention.map(({ d, kind }) => (
                <button key={d.id} type="button" className={styles.attnRow} onClick={() => setOpenId(d.id)}>
                  <span className={styles.attnWhat}>
                    {kind === "reply"
                      ? `${d.retailers?.name ?? "A shop"} replied to a receipt`
                      : `Receipt failed — ${d.retailers?.name ?? "unknown shop"}`}
                  </span>
                  <span className={styles.attnSub}>{formatOrderTime(d.created_at)}</span>
                </button>
              ))}
            </div>
          )}

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
          {/* Desktop (staff): the table trimmed to a teaser too — TIME ·
              RETAILER · BY · NET · METHOD · MSG; clicking a row expands its
              inside in place (money | trail | actions). */}
          {isStaff && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>RETAILER</th>
                  <th>BY</th>
                  <th className={styles.numeric}>NET ₹</th>
                  <th>METHOD</th>
                  <th>MSG</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((d) => {
                  const voided = d.voided_at !== null;
                  const state = depositMsgState(d.deposit_events ?? []);
                  const net = depositNetPaise(d.amount_paise, d.discount_paise);
                  const open = openId === d.id;
                  return (
                    <Fragment key={d.id}>
                      <tr
                        className={`${styles.rowLink} ${voided ? styles.rowVoided : ""} ${open ? styles.rowOpen : ""}`}
                        onClick={() => setOpenId(open ? null : d.id)}
                      >
                        <td className={styles.mono}>{formatOrderTimestamp(d.created_at, now)}</td>
                        <td className={`${styles.shopCell} ${voided ? styles.voided : ""}`}>
                          {d.retailers?.name ?? "Unknown retailer"}
                        </td>
                        <td>{d.profiles?.full_name ?? "Unknown"}</td>
                        <td className={`${styles.mono} ${styles.numeric} ${voided ? styles.voided : ""}`}>
                          {formatRupees(net)}
                        </td>
                        <td>
                          <MethodChip method={d.method} />
                        </td>
                        <td>{voided ? <span className={styles.voidTag}>VOIDED</span> : <MsgGlyph state={state} />}</td>
                      </tr>
                      {open && (
                        <tr className={styles.detailRow}>
                          <td colSpan={6}>
                            <DepositDetail
                              deposit={d}
                              voidState={voidStateFor(d)}
                              onVoid={() => openVoid(d)}
                              layout="wide"
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Mobile (staff) / always (salesman): day bands with day totals. */}
          <div className={isStaff ? styles.cardsMobile : undefined}>
            {groups.map((g) => (
              <section key={g.key} className={styles.group}>
                <p className={styles.groupHeader}>
                  <span>{g.header}</span>
                  <span className={styles.groupTotal}>{formatRupees(g.total)}</span>
                </p>
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

      {/* The deposit's inside — phone bottom sheet (desktop uses the expanded
          row instead; the sheet is hidden there by the cardsMobile split). */}
      {openRow && (
        <div className={isStaff ? styles.sheetMobileOnly : undefined}>
          <BottomSheet onClose={() => setOpenId(null)}>
            <div className={styles.dTitleRow}>
              <div>
                <p className={styles.dShop}>{openRow.retailers?.name ?? "Unknown retailer"}</p>
                {openRow.retailers?.area && <p className={styles.dArea}>{openRow.retailers.area}</p>}
              </div>
              <p className={styles.dRefs}>
                Receipt <b>{openRow.receipt_ref ?? "—"}</b>
                <br />
                {openRow.deposit_ref}
              </p>
            </div>
            <DepositDetail deposit={openRow} voidState={voidStateFor(openRow)} onVoid={() => openVoid(openRow)} layout="sheet" />
          </BottomSheet>
        </div>
      )}

      {/* Void — reason required (mirrors cancel-order's sheet). */}
      {voidTarget && (
        <BottomSheet onClose={() => setVoidTarget(null)}>
          <p className={styles.confirmTitle}>Void {voidTarget.deposit_ref}?</p>
          <p className={styles.confirmBody}>
            {voidTarget.retailers?.name} · {formatRupees(depositNetPaise(voidTarget.amount_paise, voidTarget.discount_paise))} —
            the row stays, struck out and excluded from totals. The shop gets a cancellation message.
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
