"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { formatRupees, formatOrderTime, istDateKey } from "@/lib/format";
import { depositNetPaise, describeDepositEdit } from "@/lib/deposit-fields";
import type { DepositListRow } from "@/lib/queries/deposits";
import styles from "./DepositDetail.module.css";

// The deposit's INSIDE (owner redesign 2026-09-03, from the approved
// mockups): money block, outstanding-at-recording, and the trail as a
// first-class timeline — recorded → receipt sent → delivered → reply →
// voided. Rendered inside the phone bottom sheet AND the desktop table's
// expanded row; the container decides the layout, this component the truth.

const METHOD_LABEL: Record<string, string> = { cash: "Cash", cheque: "Cheque", online: "Online" };

// The row's message state, derived from the action-only embed. Precedence:
// a reply outranks everything (the tripwire), then delivered > sent >
// failed (a failed try that later succeeded reads as sent). No events =
// no glyph (legacy rows predating WhatsApp).
export type MsgState =
  | { kind: "reply"; count: number }
  | { kind: "delivered" }
  | { kind: "sent" }
  | { kind: "failed" }
  | { kind: "none" };

export function depositMsgState(events: { action: string }[]): MsgState {
  const replies = events.filter((e) => e.action === "reply_received").length;
  if (replies > 0) return { kind: "reply", count: replies };
  const has = (a: string) => events.some((e) => e.action === a);
  if (has("receipt_delivered")) return { kind: "delivered" };
  if (has("receipt_sent")) return { kind: "sent" };
  if (has("receipt_failed")) return { kind: "failed" };
  return { kind: "none" };
}

// "917000251951" → "+91 70002 51951" — the trail shows a dialable number,
// never the raw E.164 blob the API speaks.
function prettyPhone(raw: string | undefined): string | null {
  if (!raw || !/^91\d{10}$/.test(raw)) return raw ?? null;
  return `+91 ${raw.slice(2, 7)} ${raw.slice(7)}`;
}

interface TrailEvent {
  action: string;
  created_at: string;
  details: {
    before?: Parameters<typeof describeDepositEdit>[0];
    after?: Parameters<typeof describeDepositEdit>[1];
    reason?: string;
    to?: string;
    text?: string;
    from?: string;
  } | null;
  profiles: { full_name: string } | null;
}

// action → timeline line. tone drives the dot colour; sub is the quiet
// second line; reply renders the amber quote card. Owner-alert events are
// deliberately NOT shown — dad's pings are plumbing, not shop history.
function describeEvent(e: TrailEvent): { tone: "" | "ok" | "warn" | "bad"; what: string; sub?: string } | null {
  const who = e.profiles?.full_name ?? "the office";
  switch (e.action) {
    case "created":
      return { tone: "", what: `Recorded by ${who}` };
    case "updated": {
      const changes = describeDepositEdit(e.details?.before ?? {}, e.details?.after ?? {});
      return {
        tone: "warn",
        what: `Edited by ${who}`,
        sub: changes.length
          ? changes.map((c) => (c.to ? `${c.label} ${c.from} → ${c.to}` : `${c.label} ${c.from}`)).join(" · ")
          : undefined,
      };
    }
    case "voided":
      return { tone: "bad", what: `Voided by ${who}`, sub: e.details?.reason ? `“${e.details.reason}”` : undefined };
    case "receipt_sent":
      return { tone: "", what: "Receipt sent", sub: `WhatsApp · ${prettyPhone(e.details?.to) ?? "—"}` };
    case "receipt_delivered":
      return { tone: "ok", what: "Delivered" };
    case "receipt_failed":
      return { tone: "bad", what: "Receipt failed", sub: e.details?.reason };
    case "void_notice_sent":
      return { tone: "", what: "Cancellation sent", sub: `WhatsApp · ${prettyPhone(e.details?.to) ?? "—"}` };
    case "void_notice_delivered":
      return { tone: "ok", what: "Cancellation delivered" };
    case "void_notice_failed":
      return { tone: "bad", what: "Cancellation failed", sub: e.details?.reason };
    case "reply_received":
      return { tone: "warn", what: "Shop replied" };
    // Owner pings and their delivery ticks: logged, not displayed.
    case "owner_alert_sent":
    case "owner_alert_failed":
    case "owner_alert_delivered":
    case "owner_void_alert_sent":
    case "owner_void_alert_failed":
    case "owner_void_alert_delivered":
      return null;
    default:
      return { tone: "", what: e.action };
  }
}

// "You can void by 2:44 pm today." — the deadline as a clock time, not a
// countdown (owner 2026-09-03). A window that crosses midnight says
// tomorrow; the RPC remains the real gate either way.
function voidDeadline(until: string): string {
  const day = istDateKey(new Date(until)) === istDateKey(new Date()) ? "today" : "tomorrow";
  return `You can void by ${formatOrderTime(until)} ${day}.`;
}

interface DepositDetailProps {
  deposit: DepositListRow;
  // Void affordance, decided by the parent (same gate as the RPC): "window"
  // shows the button + deadline, "admin" the bare button (owner 2026-09-03:
  // no anytime caption), "closed" the ask-the-office line; a voided row
  // shows its banner instead.
  voidState: { kind: "window"; until: string } | { kind: "admin" } | { kind: "closed" };
  onVoid: () => void;
  // Desktop’s expanded row lays the three sections side by side.
  layout: "sheet" | "wide";
}

export function DepositDetail({ deposit: d, voidState, onVoid, layout }: DepositDetailProps) {
  const { data: events, isError } = useQuery({
    queryKey: ["deposit-events", d.id],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("deposit_events")
        .select("action, created_at, details, profiles!deposit_events_actor_id_fkey(full_name)")
        .eq("deposit_id", d.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as TrailEvent[];
    },
  });

  const voided = d.voided_at !== null;
  const net = depositNetPaise(d.amount_paise, d.discount_paise);
  const prev = d.previous_outstanding_paise;
  const after = prev === null ? null : prev - d.amount_paise;

  return (
    <div className={layout === "wide" ? styles.wide : styles.stack}>
      <div>
        <p className={styles.sLabel}>MONEY</p>
        <div className={styles.money}>
          <div className={styles.mRow}>
            <span>Gross (on receipt)</span>
            <span className={styles.mVal}>{formatRupees(d.amount_paise)}</span>
          </div>
          <div className={styles.mRow}>
            <span>Discount</span>
            <span className={styles.mVal}>− {formatRupees(d.discount_paise)}</span>
          </div>
          <div className={`${styles.mRow} ${styles.mNet}`}>
            <span className={styles.mNetLbl}>
              Net received<span className={styles.chip}>{METHOD_LABEL[d.method] ?? d.method}</span>
            </span>
            <span className={`${styles.mVal} ${styles.mNetVal}`}>{formatRupees(net)}</span>
          </div>
        </div>
        <p className={styles.refs}>
          Receipt book <b>{d.receipt_ref ?? "—"}</b> · App <b>{d.deposit_ref}</b>
          {d.note ? (
            <>
              <br />
              {d.method === "cheque" ? "Cheque no. " : d.method === "online" ? "Ref " : ""}
              {d.note}
            </>
          ) : null}
        </p>
        {prev !== null && (
          <>
            <p className={styles.sLabel}>OUTSTANDING AT RECORDING</p>
            <div className={styles.outLine}>
              <span className={`${styles.outFig} ${prev > 0 ? styles.owed : styles.clear}`}>{formatRupees(prev)}</span>
              <span className={styles.outArrow}>→</span>
              <span className={`${styles.outFig} ${(after ?? 0) > 0 ? styles.owed : styles.clear}`}>
                {formatRupees(after ?? 0)}
              </span>
            </div>
          </>
        )}
      </div>

      <div>
        <p className={styles.sLabel}>TRAIL</p>
        {isError ? (
          <p className={styles.trailNote}>Couldn&apos;t load the history — try again.</p>
        ) : !events ? (
          <p className={styles.trailNote}>…</p>
        ) : (
          <ul className={styles.tl}>
            {events.map((e, i) => {
              const line = describeEvent(e);
              if (!line) return null;
              return (
                <li key={i} className={styles[`tone_${line.tone || "plain"}`]}>
                  <span className={styles.tlWhat}>{line.what}</span>
                  <span className={styles.tlWhen}>{formatOrderTime(e.created_at)}</span>
                  {line.sub && <div className={styles.tlSub}>{line.sub}</div>}
                  {e.action === "reply_received" && e.details?.text && (
                    <div className={styles.replyCard}>
                      <div className={styles.replyWho}>SHOP&apos;S REPLY</div>
                      {e.details.text}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        {voided ? (
          <div className={styles.voidedBanner}>
            Voided{d.void_reason ? <> — “{d.void_reason}”</> : null}
          </div>
        ) : voidState.kind === "closed" ? (
          <p className={styles.voidCaption}>Window closed — ask the office to void it.</p>
        ) : (
          <>
            {layout === "wide" && <p className={styles.sLabel}>ACTIONS</p>}
            <button type="button" className={styles.voidBtn} onClick={onVoid}>
              Void deposit
            </button>
            {voidState.kind === "window" && <p className={styles.voidCaption}>{voidDeadline(voidState.until)}</p>}
          </>
        )}
      </div>
    </div>
  );
}
