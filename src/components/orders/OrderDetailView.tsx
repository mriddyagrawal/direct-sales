"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, Copy, Pencil, ScanBarcode, Send, Stamp, Truck, Undo2, X } from "lucide-react";
import { StatusTag } from "@/components/ui/StatusTag";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { SharePdfButton } from "@/components/SharePdfButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { getOrderStatusTag } from "@/lib/order-status";
import { formatOrderTimestamp, formatOrderTime, formatHistoryDayHeader, formatRupees, istDateKey } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { describeEvent, type OrderEventRow } from "@/lib/order-events";
import { cancelOrder, processOrder, approveOrder, punchOrder, setAdminComment, dispatchOrder, stepBackOrder } from "@/lib/order-rpcs";
import styles from "./OrderDetailView.module.css";

interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_paise: number;
  qty: number;
  line_total_paise: number;
  picked_qty: number | null;
  position: number;
  // Stock AT ORDER TIME (static snapshot, like the price). NULL = the product
  // had no Tally stock data when ordered. A count, never money.
  stock_at_order: number | null;
  // LIST price at order time (paise) — the reference unit_price_paise (the
  // charged rate) is compared against. NULL (historical / unpriced manual
  // default) → no comparison shown. Immutable snapshot.
  list_price_at_order: number | null;
  products: { tally_name: string } | null;
  order_item_scans: { id: string; serial: string; scanned_at: string }[];
}

// Order-time stock flag (owner 2026-07-17): flags PROBLEMS only — an in-stock
// line (stock >= qty) renders nothing. Static: derived from the snapshot,
// never from live stock. NULL (no Tally data at order time) is treated as NOT
// IN STOCK. Text matches the Quick Order pill's voice (sentence case, "·"),
// with "available N" — not a fraction, which read like a pick figure.
function stockAtOrderPill(stock: number | null, qty: number): string | null {
  const s = stock ?? 0;
  if (s === 0) return "Out of stock";
  if (s < qty) return `Partial stock · available ${s}`;
  return null;
}

interface RawEventRow {
  id: number;
  action: string;
  actor_id: string | null;
  details: unknown;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface OrderDetailData {
  id: string;
  orderRef: string;
  status: string;
  notes: string;
  adminComment: string | null;
  totalPaise: number;
  submittedAt: string;
  editableUntil: string;
  processedAt: string | null;
  tallyBillNo: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancelledByName: string | null;
  salesmanId: string;
  parentOrderId: string | null;
  parentOrderRef: string | null;
  salesmanName: string;
  processedByName: string | null;
  retailerName: string;
  retailerArea: string | null;
  retailerPhone: string | null;
  retailerVerified: boolean;
  brandName: string | null;
  showModel: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
  pickedAt: string | null;
  pickedByName: string | null;
  dispatchedAt: string | null;
  dispatchedByName: string | null;
  dispatchNote: string | null;
}

interface OrderDetailViewProps {
  order: OrderDetailData;
  items: OrderItemRow[];
  events: RawEventRow[];
  currentUserId: string;
  role: "salesman" | "staff" | "godown";
  isAdmin: boolean;
}

// THE order detail — one component, every role (unification, owner decision
// 2026-07-10). The role decides which ACTIONS render; the boilerplate
// (header, lines, total, serials, notes, retailer, history, Share PDF) is
// identical. This view is READ-ONLY: every edit — for the salesman AND for
// staff — routes to the Quick Order flow (/new-order?edit=…), the sole editor
// now (owner 2026-07-16). Actions follow the cancel/edit permission matrices
// (owner 2026-07-11): accountant acts only on pending_approval; admin on any
// live order (Edit — reason past approval, captured in the flow; Cancel with
// reason); salesman edits/cancels only his own pending_approval order (the 2h
// window is gone), read-only after. Hiding a button is cosmetic — every write
// goes through the same role-guarded RPCs either way.
export function OrderDetailView({ order, items: initialItems, events, currentUserId, role, isAdmin }: OrderDetailViewProps) {
  const router = useRouter();
  // Read-only now: the qty map is built once from the fetched lines (editing
  // lives in the Quick Order flow, not here).
  const items = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const it of initialItems) map[it.product_id] = it.qty;
    return map;
  }, [initialItems]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmProcess, setConfirmProcess] = useState(false);
  const [confirmDispatch, setConfirmDispatch] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [dispatchNote, setDispatchNote] = useState("");
  const [billNo, setBillNo] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  // Admin held-stage note draft (admin box), seeded from the current note.
  const [commentDraft, setCommentDraft] = useState(order.adminComment ?? "");
  const [savingComment, setSavingComment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Dedicated NAVIGATION transition — kept separate from the save/approve
  // `isPending` so a bare router.push shows a spinner on ONLY the tapped
  // button (instant tap feedback, complementing the route loading.tsx). The
  // `navTarget` key disambiguates when Edit + Scan co-render (salesman view).
  const [navPending, startNav] = useTransition();
  const [navTarget, setNavTarget] = useState<string | null>(null);
  const navigate = (path: string) => {
    setNavTarget(path);
    startNav(() => router.push(path));
  };
  const [error, setError] = useState<string | null>(null);
  const [tick] = useState(nowMs);

  const now = useMemo(() => new Date(tick), [tick]);
  const isStaff = role === "staff";
  const isGodown = role === "godown";
  const isOwner = order.salesmanId === currentUserId;
  // Editability is status-driven now — the 2h edit-window timer is gone (owner
  // decision 2026-07-11). A `pending_approval` order is freely editable; once
  // approved it's locked (admin-only past that, reason-logged, server-side).
  const editable = order.status === "pending_approval";
  // The salesman may edit/cancel only his own order, only while it's still
  // pending_approval (the cancel_order/update_order_items RPCs enforce this).
  const salesmanActionable = role === "salesman" && isOwner && editable;
  // Who sees the Edit button (which routes to the Quick Order flow): staff per
  // the cancel/edit matrix (admin — any live order bar cancelled, dispatched
  // included per owner 2026-07-16; accountant — pending only), or the salesman
  // on his own pending order. Matches the page loader + update_order_items (both
  // already allow any non-cancelled for an admin).
  const canEdit =
    (isStaff && (isAdmin ? order.status !== "cancelled" : order.status === "pending_approval")) ||
    salesmanActionable;
  const editHref = `/new-order?edit=${order.id}`;
  // Admin "Undo" (owner 2026-07-17): one stage backward, only from the four
  // forward stages — never cancelled/pending/backorder. The guard trigger and
  // step_back_order re-enforce admin server-side; this is just the button gate.
  const canUndo =
    isAdmin && ["approved", "ready_to_bill", "billed", "dispatched"].includes(order.status);
  const statusTag = getOrderStatusTag({ status: order.status });

  const snapshotById = useMemo(() => {
    const map: Record<string, { name: string; price: number }> = {};
    for (const it of initialItems) map[it.product_id] = { name: it.product_name, price: it.unit_price_paise };
    return map;
  }, [initialItems]);

  // Model + serials per original line (spec §3 ITEMS): the model is the
  // CURRENT product's tally_name (display-only); serials in scan order.
  // A line newly added in edit mode has neither yet.
  const lineExtraByProduct = useMemo(() => {
    const map = new Map<
      string,
      {
        model: string | null;
        serials: string[];
        pickedQty: number | null;
        stockAtOrder: number | null;
        listPriceAtOrder: number | null;
      }
    >();
    for (const it of initialItems) {
      map.set(it.product_id, {
        model: it.products?.tally_name ?? null,
        serials: [...it.order_item_scans]
          .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))
          .map((s) => s.serial),
        pickedQty: it.picked_qty,
        stockAtOrder: it.stock_at_order,
        listPriceAtOrder: it.list_price_at_order,
      });
    }
    return map;
  }, [initialItems]);

  const lines = Object.entries(items)
    .map(([productId, qty]) => {
      const snap = snapshotById[productId];
      const name = snap?.name ?? "Unknown product";
      const rate = snap?.price ?? 0;
      const extra = lineExtraByProduct.get(productId);
      return {
        productId,
        qty,
        name,
        rate,
        model: extra?.model ?? null,
        serials: extra?.serials ?? [],
        pickedQty: extra?.pickedQty ?? null,
        stockAtOrder: extra?.stockAtOrder ?? null,
        listPriceAtOrder: extra?.listPriceAtOrder ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // List-vs-charged (owner 2026-07-17, on-screen only): a line is "off-list"
  // when its captured list price exists and differs from the charged rate.
  // The order-level list total uses the same shipped basis as total_paise
  // (picked ?? qty), so the two totals compare like-for-like; a NULL list
  // contributes the charged rate (no fabricated gap on historical lines).
  const listTotal = lines.reduce(
    (sum, l) => sum + (l.listPriceAtOrder ?? l.rate) * (l.pickedQty ?? l.qty),
    0,
  );
  const offList = listTotal !== order.totalPaise && listTotal > 0;
  const orderDeltaPct = offList ? Math.round(((order.totalPaise - listTotal) / listTotal) * 1000) / 10 : 0;

  // Once picked, a line shows shipped-vs-ordered; short lines feed the backorder.
  const anyPicked = initialItems.some((it) => it.picked_qty !== null);
  const backorderedUnits = initialItems.reduce(
    (sum, it) => sum + (it.picked_qty !== null ? Math.max(0, it.qty - it.picked_qty) : 0),
    0,
  );
  const isBackorder = order.status === "backorder";
  // The child backorder (id + ref), read off the 'backordered' event this
  // order logged when it shipped short.
  const backorderChild = (() => {
    const ev = events.find((e) => e.action === "backordered");
    const details = (ev?.details ?? {}) as Record<string, unknown>;
    const id = typeof details.child_order_id === "string" ? details.child_order_id : null;
    const ref = typeof details.child_ref === "string" ? details.child_ref : null;
    return id && ref ? { id, ref } : null;
  })();

  // Per-status Undo confirm copy: the destination + the side effect it carries.
  // An un-pick that split a backorder names the child it will cancel.
  const undoCopy: Record<string, string> = {
    approved: "Send this order back to Pending approval?",
    ready_to_bill: `Send back to Approved? The pick will be cleared${
      backorderChild ? ` and backorder ${backorderChild.ref} will be cancelled` : ""
    }.`,
    billed: "Send back to Ready to bill? This removes the Tally bill number.",
    dispatched: "Send back to Billed?",
  };

  // A `backordered` HISTORY line references the other order (parent↔child) —
  // return the ref as a link so it's tappable, mirroring the "Backorder of"
  // header link. Returns null for every non-linkable event (plain describeEvent).
  const detailBase = isStaff ? "/dashboard/orders" : isGodown ? "/godown/orders" : "/orders";
  function backorderEventLink(e: OrderEventRow): { prefix: string; ref: string; href: string } | null {
    if (e.action !== "backordered") return null;
    const d = (e.details ?? {}) as Record<string, unknown>;
    const time = formatOrderTime(e.created_at);
    if (typeof d.parent_ref === "string" && typeof d.parent_order_id === "string") {
      return { prefix: `${time} Backordered from `, ref: d.parent_ref, href: `${detailBase}/${d.parent_order_id}` };
    }
    if (typeof d.child_ref === "string" && typeof d.child_order_id === "string") {
      return { prefix: `${time} Backordered → `, ref: d.child_ref, href: `${detailBase}/${d.child_order_id}` };
    }
    return null;
  }

  // Godown-scanned serials per line (scan order), for the accountant to read
  // into Tally. Empty for fixed brands and for approved→processed overrides.
  const serialGroups = useMemo(
    () =>
      [...initialItems]
        .sort((a, b) => a.position - b.position)
        .filter((it) => (it.order_item_scans ?? []).length > 0)
        .map((it) => ({
          id: it.id,
          name: it.product_name,
          serials: [...it.order_item_scans]
            .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))
            .map((s) => s.serial),
        })),
    [initialItems],
  );
  // Serial sub-rows nest under each line on show_model brands (spec §3) —
  // BOTH roles (owner flip 2026-07-11: the salesman sees his own serials; an
  // RLS policy scopes him to his own orders). The italic "captured at
  // picking" teaching placeholder stays STAFF-only — the salesman just sees
  // serials once they exist.
  const showSerialRows = order.showModel;
  const serialsPending = isStaff && (order.status === "pending_approval" || order.status === "approved");
  const hasAnySerials = serialGroups.length > 0;

  async function handleCopySerials() {
    const text = serialGroups.map((g) => `${g.name}\n${g.serials.join("\n")}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the serials by hand.");
    }
  }

  const events2: OrderEventRow[] = events.map((e) => ({
    id: e.id,
    action: e.action,
    actor_id: e.actor_id,
    actor_name: e.profiles?.full_name ?? null,
    details: e.details,
    created_at: e.created_at,
  }));

  async function handleApprove() {
    setSaving(true);
    setError(null);
    try {
      await approveOrder(order.id);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve the order.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePunch() {
    setSaving(true);
    setError(null);
    try {
      await punchOrder(order.id);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not punch the order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetComment() {
    // Admin-only held-stage note. Empty submission clears it (server + UI).
    setSavingComment(true);
    setError(null);
    try {
      await setAdminComment(order.id, commentDraft);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note.");
    } finally {
      setSavingComment(false);
    }
  }

  async function handleProcess() {
    // Client-side mirror of the RPC's non-empty guard — the server rejects an
    // empty bill number too (single source of truth), this just saves a round
    // trip and shows the message inline.
    if (!billNo.trim()) {
      setError("Enter the Tally bill number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await processOrder(order.id, billNo.trim());
      setConfirmProcess(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process the order.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDispatch() {
    // billed → dispatched (physically shipped). godown/accountant/admin only;
    // the RPC re-checks the role. The remark (vehicle no. / LR no.) is required
    // in the UI — the DB column is nullable for now (pre-backfill), so this
    // client guard is what enforces it.
    if (!dispatchNote.trim()) {
      setError("Enter a dispatch remark (vehicle no., LR no., etc.).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await dispatchOrder(order.id, dispatchNote.trim());
      setConfirmDispatch(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark the order dispatched.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUndo() {
    // One stage backward (admin-only, re-checked server-side). No reason —
    // the RPC audits a 'stepped_back' event itself. A blocked un-pick (advanced
    // backorder child) raises; the sheet renders that child's ref as a link.
    setSaving(true);
    setError(null);
    try {
      await stepBackOrder(order.id);
      setConfirmUndo(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo the last step.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    // Staff must give a reason (RPC demands it); the salesman's in-window
    // self-cancel is reason-free — same rule the RPC applies.
    if (isStaff && !cancelReason.trim()) {
      setError("Reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cancelOrder(order.id, isStaff ? cancelReason.trim() : undefined);
      setConfirmCancel(false);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the order.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* Back-eyebrow (spec §3): ‹ REF on the left, status chip on the right. */}
      <div className={styles.backRow}>
        <Link href={isStaff ? "/dashboard" : isGodown ? "/godown" : "/"} className={styles.breadcrumb}>
          <Glyph icon={ChevronLeft} />
          <span className={styles.backRef}>{order.orderRef}</span>
        </Link>
        <StatusTag tone={statusTag.tone} label={statusTag.label} sublabel={statusTag.sublabel} />
      </div>

      {/* Hero (spec §3): the RETAILER is the headline — name bold + large,
          then `area · phone · salesman` (phone is staff-only), then the
          timeline byline. */}
      <div className={styles.hero}>
        <p className={styles.heroRetailer}>
          {order.retailerName}
          {!order.retailerVerified && <span className={styles.newBadge}>NEW</span>}
        </p>
        {(() => {
          // Salesman gets the minimal meta; staff AND godown get the fuller
          // area · phone · salesman (godown is a read-only staff-like lens).
          const metaParts =
            role === "salesman"
              ? [order.retailerArea]
              : [order.retailerArea, order.retailerPhone, order.salesmanName];
          const meta = metaParts.filter(Boolean).join(" · ");
          return meta ? <p className={styles.heroMeta}>{meta}</p> : null;
        })()}
        {/* Billed byline: when + who + the Tally bill number. `Bill #` only
            renders when present, so the pre-existing billed orders (null bill
            no) show the byline without it. */}
        {(order.status === "billed" || order.status === "dispatched") && order.processedAt && (
          <p className={styles.byline}>
            billed {formatOrderTimestamp(order.processedAt, now)}
            {order.processedByName ? ` by ${order.processedByName}` : ""}
            {order.tallyBillNo ? ` · Bill #${order.tallyBillNo}` : ""}
            {order.status === "dispatched" && order.dispatchedAt
              ? ` · dispatched ${formatOrderTimestamp(order.dispatchedAt, now)}${
                  order.dispatchedByName ? ` by ${order.dispatchedByName}` : ""
                }${order.dispatchNote ? ` · ${order.dispatchNote}` : ""}`
              : ""}
          </p>
        )}
      </div>

      {/* Admin note (RED) — a held-stage flag from the admin, visible to
          EVERYONE who can see the order (the salesman included) but ONLY while
          the order is still pending_approval. Distinct from the salesman's own
          "notes from the field". Cleared on approval; hidden once the order
          leaves the held stage (cancelled/approved/…) even if the column still
          carries the text — the note only means "why this is being held". */}
      {order.adminComment && order.status === "pending_approval" && (
        <p className={styles.adminNote}>
          <span className={styles.adminNoteLabel}>Admin note</span>
          {order.adminComment}
        </p>
      )}

      {/* Admin-only: write / edit / clear the held-stage note (pending only). */}
      {isStaff && isAdmin && order.status === "pending_approval" && (
        <div className={styles.adminCommentBox}>
          <label className={styles.adminCommentLabel}>ADMIN NOTE · VISIBLE TO THE SALESMAN</label>
          <textarea
            className={styles.adminCommentInput}
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder="e.g. confirm 5-star stock before I approve"
          />
          <Button variant="secondary" onClick={handleSetComment} loading={savingComment}>
            {order.adminComment ? "Update note" : "Add note"}
          </Button>
        </div>
      )}

      {/* One action BLOCK: primary + secondaries share the same 8px rhythm
          vertically and horizontally (owner call). */}
      <div className={styles.actionBlock}>
      {/* PRIMARY action = the status (spec §5): pending → Approve (admin only);
          ready_to_bill → Mark billed; billed/cancelled → Share PDF. `approved`
          deliberately has NO loud primary (§4) — the godown owns the next move;
          the admin override rides in the secondaries. */}
      {isStaff && isAdmin && order.status === "pending_approval" && (
        <Button variant="success" onClick={handleApprove} loading={saving || isPending}>
          <Glyph icon={CheckCircle2} />
          Approve order
        </Button>
      )}
      {isStaff && order.status === "ready_to_bill" && (
        <Button variant="primary" onClick={() => setConfirmProcess(true)}>
          <Glyph icon={Stamp} />
          Mark billed
        </Button>
      )}
      {/* Mark dispatched — the primary on a BILLED order for godown + staff
          (accountant/admin); never the salesman. Light confirm, no input. */}
      {order.status === "billed" && (isStaff || isGodown) && (
        <Button variant="primary" onClick={() => setConfirmDispatch(true)}>
          <Glyph icon={Truck} />
          Mark dispatched
        </Button>
      )}
      {/* Share PDF is the primary on the read-only terminal views (never godown):
          a cancelled order, a dispatched order, or a billed order the salesman sees. */}
      {role !== "godown" &&
        (order.status === "cancelled" ||
          order.status === "dispatched" ||
          (order.status === "billed" && role === "salesman")) && (
          <SharePdfButton orderId={order.id} orderRef={order.orderRef} retailerName={order.retailerName} variant="primary" />
        )}
      {isStaff && order.status === "approved" && (
        <>
          <p className={styles.waitLine}>Waiting for the godown to scan serials.</p>
          {/* Mark billed removed from the Pending-scan screen (owner 2026-07-12):
              every order must reach ready_to_bill via the godown pick first. The
              approved→billed path stays dormant in process_order in case we
              restore the shortcut later. */}
          <Button
            variant="secondary"
            loading={navPending && navTarget === `/scan/${order.id}`}
            onClick={() => navigate(`/scan/${order.id}`)}
          >
            <Glyph icon={ScanBarcode} />
            Scan
          </Button>
        </>
      )}
      {/* Backorder: the remainder split off a partial pick. Its salesman or an
          admin can edit the quantities (secondaries) then Punch it back into
          the pipeline (→ pending_approval). */}
      {isBackorder && (
        <>
          {order.parentOrderRef && (
            <p className={styles.waitLine}>
              Backorder of{" "}
              <Link href={`${detailBase}/${order.parentOrderId}`} className={styles.parentLink}>
                {order.parentOrderRef}
              </Link>
            </p>
          )}
          {(isOwner || isAdmin) && (
            <Button variant="primary" onClick={handlePunch} loading={saving || isPending}>
              <Glyph icon={Send} />
              Punch order
            </Button>
          )}
        </>
      )}

      {/* SECONDARIES (glyph + label; Cancel red at the far end — spec §3/§5).
          Every write still goes through the role-guarded RPCs; hiding a button
          is cosmetic. Permission matrices (owner 2026-07-11 — see
          docs/specs/cancel-edit-permissions-proposal.md):
          EDIT   — salesman & accountant: pending_approval only; admin: any
                   non-cancelled (reason once past approval).
          CANCEL — salesman: own pending; accountant: pending only; admin: any. */}
      <div className={styles.secondaries}>
        {/* Edit — the single editor now: routes to the Quick Order flow
            (/new-order?edit=…) for staff AND salesman alike (owner 2026-07-16;
            the inline editor is retired). Gate = the cancel/edit matrix. */}
        {canEdit && (
          <Button
            variant="secondary"
            loading={navPending && navTarget === editHref}
            onClick={() => navigate(editHref)}
          >
            <Glyph icon={Pencil} />
            Edit
          </Button>
        )}
        {/* Share as a SECONDARY wherever it isn't the primary: non-terminal
            states (both non-godown roles) + a billed order for staff (Mark
            dispatched took the primary). Not for godown; not for dispatched/
            cancelled (Share is their primary there). */}
        {role !== "godown" &&
          order.status !== "cancelled" &&
          order.status !== "dispatched" &&
          !(order.status === "billed" && role === "salesman") && (
            <SharePdfButton orderId={order.id} orderRef={order.orderRef} retailerName={order.retailerName} variant="ink" />
          )}
        {/* Salesman scans his own approved LG order — Share | Scan splits the
            secondaries (staff get Scan in the split override above instead). */}
        {role === "salesman" && order.status === "approved" && (
          <Button
            variant="secondary"
            loading={navPending && navTarget === `/scan/${order.id}`}
            onClick={() => navigate(`/scan/${order.id}`)}
          >
            <Glyph icon={ScanBarcode} />
            Scan
          </Button>
        )}
        {/* Admin Undo — red OUTLINE (the inverse of Cancel's fill; inverts to
            solid red on press). One stage backward, confirm sheet, no reason. */}
        {canUndo && (
          <Button variant="destructive" onClick={() => setConfirmUndo(true)}>
            <Glyph icon={Undo2} />
            Undo
          </Button>
        )}
        {((isStaff && (isAdmin ? order.status !== "cancelled" : order.status === "pending_approval")) ||
          salesmanActionable) && (
          <Button
            variant="destructive-filled"
            className={styles.cancelAction}
            onClick={() => setConfirmCancel(true)}
          >
            <Glyph icon={X} />
            Cancel
          </Button>
        )}
      </div>
      </div>

      {error && !confirmCancel && !confirmProcess && !confirmDispatch && !confirmUndo && (
        <p className={styles.error}>{error}</p>
      )}

      {/* Shipped short: a partial pick shipped what was picked and backordered
          the rest into a child order (both roles). */}
      {anyPicked && backorderedUnits > 0 && (
        <p className={styles.noteBackorder}>
          {backorderedUnits} unit{backorderedUnits === 1 ? "" : "s"} backordered
          {backorderChild && (
            <>
              {" → "}
              <Link href={`${detailBase}/${backorderChild.id}`} className={styles.parentLink}>
                {backorderChild.ref}
              </Link>
            </>
          )}
        </p>
      )}

      {/* Salesman guidance notes — what the status means for HIM and what
          happens next (ported verbatim from the old /orders/[id] page). Gated to
          the SALESMAN explicitly: `!isStaff` would also catch the godown lens,
          which must NOT inherit these "waiting for approval…" banners. */}
      {role === "salesman" && (
        <>
          {order.status === "pending_approval" && (
            <p className={styles.noteLocked}>
              Waiting for office approval{salesmanActionable ? " — you can still edit it until it's approved." : "."}
            </p>
          )}
          {order.status === "approved" && (
            <p className={styles.noteProcessed}>Approved by the office — waiting to be processed.</p>
          )}
          {order.status === "ready_to_bill" && (
            <p className={styles.noteProcessed}>Approved — the office will bill it shortly.</p>
          )}
          {order.status === "billed" && (
            <p className={styles.noteProcessed}>Booked into Tally by the office. For any change, call the accountant.</p>
          )}
          {order.status === "cancelled" && (
            <p className={styles.noteCancelled}>
              Cancelled {formatOrderTimestamp(order.cancelledAt ?? order.submittedAt, now)}
              {order.cancelledById === currentUserId ? " — by you." : " — by the office."}
            </p>
          )}
        </>
      )}

      <div className={styles.body}>
        <div className={styles.main}>
          {isStaff && showSerialRows && hasAnySerials && (
            <div className={styles.itemsHead}>
              <button type="button" className={styles.copySerials} onClick={handleCopySerials}>
                <Glyph icon={Copy} size={14} />
                {copied ? "Copied ✓" : "Copy serials"}
              </button>
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ITEM</th>
                <th className={styles.numeric}>QTY</th>
                <th className={styles.numeric}>RATE</th>
                <th className={styles.numeric}>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                // Zero taken (picked, none) — the whole line struck in grey.
                const zeroTaken = line.pickedQty === 0;
                return (
                <Fragment key={line.productId}>
                  <tr>
                    <td className={zeroTaken ? styles.struck : undefined}>
                      {/* Model eyebrow (spec §3): show_model brands lead each
                          line with the mono model; both roles see it. */}
                      {order.showModel && line.model && line.model !== line.name && (
                        <span className={styles.modelEyebrow}>{line.model}</span>
                      )}
                      {line.name}
                      {/* Order-time stock flag (all roles): problems only —
                          dot + red text below the name, Quick Order style
                          (NULL counts as out of stock). In-stock: nothing. */}
                      {(() => {
                        const pill = stockAtOrderPill(line.stockAtOrder, line.qty);
                        return pill ? <span className={styles.stockAtOrderPill}>{pill}</span> : null;
                      })()}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric}`}>
                      {line.pickedQty !== null && line.pickedQty < line.qty ? (
                        // Short line (incl. 0 taken): the taken figure stays a
                        // legible ink number, ordered qty struck beside it —
                        // "0 3̶" reads far clearer than a lone struck digit.
                        <>
                          {line.pickedQty} <span className={styles.orderedStruck}>{line.qty}</span>
                        </>
                      ) : (
                        line.qty
                      )}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric} ${zeroTaken ? styles.struck : ""}`}>
                      {/* Off-list line: struck LIST + charged rate, signed
                          delta beneath. At-list / no-list → just the rate. */}
                      {line.listPriceAtOrder != null &&
                      line.listPriceAtOrder > 0 &&
                      line.listPriceAtOrder !== line.rate ? (
                        <>
                          <span className={styles.listStruck}>{formatRupees(line.listPriceAtOrder)}</span>{" "}
                          {formatRupees(line.rate)}
                          {(() => {
                            const d = Math.round(((line.rate - line.listPriceAtOrder) / line.listPriceAtOrder) * 100);
                            // Signed AND colored (owner 2026-07-19): a discount
                            // (−) reads red, a markup (+) reads green.
                            return (
                              <span className={`${styles.rateDelta} ${d >= 0 ? styles.deltaUp : styles.deltaDown}`}>
                                {`${d >= 0 ? "+" : "−"}${Math.abs(d)}%`}
                              </span>
                            );
                          })()}
                        </>
                      ) : (
                        formatRupees(line.rate)
                      )}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric} ${zeroTaken ? styles.struck : ""}`}>
                      {/* Shipped amount = (picked ?? ordered) × rate, so the lines
                          sum to the shipped order total. A zero-taken line keeps its
                          ORIGINAL amount (struck), not ₹0. */}
                      {zeroTaken
                        ? formatRupees(line.rate * line.qty)
                        : formatRupees(line.rate * (line.pickedQty ?? line.qty))}
                    </td>
                  </tr>
                  {/* Serials nest under their line (staff, show_model brands):
                      real serials once picked, the teaching placeholder before. */}
                  {showSerialRows && (line.serials.length > 0 || serialsPending) && (
                    <tr className={styles.serialSubRow}>
                      <td colSpan={4}>
                        {line.serials.length > 0 ? (
                          <span className={styles.serialWrap}>
                            <em className={styles.serialTag}>Serials</em>
                            <span className={styles.serialList}>
                              {line.serials.map((serial) => (
                                <span key={serial} className={styles.serialLine}>
                                  {serial}
                                </span>
                              ))}
                            </span>
                          </span>
                        ) : (
                          <em className={styles.serialPlaceholder}>captured at picking, after approval</em>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Off-list order: the list total above the charged Total, and the
              signed order-level delta beside it. At-list orders: nothing new. */}
          {offList && (
            <div className={styles.listTotalRow}>
              <span />
              <span className={styles.mono}>List {formatRupees(listTotal)}</span>
            </div>
          )}
          <div className={styles.totalRow}>
            {/* Shipped units + the authoritative shipped total (order.totalPaise). */}
            {(() => {
              const units = lines.reduce((sum, l) => sum + (l.pickedQty ?? l.qty), 0);
              return (
                <span>
                  {units} {units === 1 ? "unit" : "units"}
                </span>
              );
            })()}
            <span className={styles.mono}>
              Total (incl. GST) {formatRupees(order.totalPaise)}
              {offList && (
                <span className={`${styles.totalDelta} ${orderDeltaPct >= 0 ? styles.deltaUp : styles.deltaDown}`}>
                  {" "}
                  ({orderDeltaPct >= 0 ? "+" : "−"}
                  {Math.abs(orderDeltaPct)}%)
                </span>
              )}
            </span>
          </div>
        </div>

        <div className={styles.rail}>
          <div className={styles.notesBox}>
            <p className={styles.notesLabel}>NOTES FROM THE FIELD</p>
            <p className={styles.notesText}>{order.notes || "— no notes —"}</p>
          </div>

          <div>
            <p className={styles.sectionLabel}>HISTORY</p>
            {/* Grouped by IST calendar day: a bold day header ("Today" /
                "Yesterday" / "10 Jul 2026") then that day's lines carry the time
                only. events2 is chronological (oldest first), so the groups run
                oldest day → Today, and a weeks-long history stays unambiguous. */}
            {(() => {
              const groups: { key: string; header: string; events: OrderEventRow[] }[] = [];
              for (const e of events2) {
                const key = istDateKey(new Date(e.created_at));
                const last = groups[groups.length - 1];
                if (last && last.key === key) last.events.push(e);
                else groups.push({ key, header: formatHistoryDayHeader(e.created_at, now), events: [e] });
              }
              return groups.map((g) => (
                <div key={g.key} className={styles.historyGroup}>
                  <p className={styles.historyDate}>{g.header}</p>
                  {g.events.map((e) => {
                    // A `backordered` event names the other order — link that ref
                    // to it (parent↔child); everything else is plain text.
                    const link = backorderEventLink(e);
                    return (
                      <p key={e.id} className={styles.historyLine}>
                        {link ? (
                          <>
                            {link.prefix}
                            <Link href={link.href} className={styles.parentLink}>
                              {link.ref}
                            </Link>
                          </>
                        ) : (
                          describeEvent(e, currentUserId)
                        )}
                      </p>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      {confirmProcess && (
        <BottomSheet onClose={() => setConfirmProcess(false)}>
          <p className={styles.confirmTitle}>Mark {order.orderRef} billed?</p>
          <p className={styles.confirmBody}>The salesman&apos;s app goes read-only for this order immediately.</p>
          <label className={styles.notesLabel}>TALLY BILL NUMBER</label>
          <input
            className={styles.billNoInput}
            value={billNo}
            onChange={(e) => setBillNo(e.target.value)}
            placeholder="e.g. GE/2026-27/0421"
            autoFocus
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.editActions}>
            <Button variant="secondary" onClick={() => setConfirmProcess(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleProcess} loading={saving || isPending}>
              Mark billed
            </Button>
          </div>
        </BottomSheet>
      )}

      {confirmDispatch && (
        <BottomSheet onClose={() => setConfirmDispatch(false)}>
          <p className={styles.confirmTitle}>Mark {order.orderRef} dispatched?</p>
          <p className={styles.confirmBody}>Confirms the goods have physically shipped — this is the final stage.</p>
          <label className={styles.notesLabel}>DISPATCH REMARK (vehicle no., LR no., etc.)</label>
          <input
            className={styles.billNoInput}
            value={dispatchNote}
            onChange={(e) => setDispatchNote(e.target.value)}
            placeholder="e.g. MH-01-AB-1234"
            autoFocus
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.editActions}>
            <Button variant="secondary" onClick={() => setConfirmDispatch(false)}>
              Not yet
            </Button>
            <Button variant="primary" onClick={handleDispatch} loading={saving || isPending}>
              <Glyph icon={Truck} />
              Mark dispatched
            </Button>
          </div>
        </BottomSheet>
      )}

      {confirmUndo && (
        <BottomSheet onClose={() => setConfirmUndo(false)}>
          <p className={styles.confirmTitle}>Undo — {order.orderRef}</p>
          <p className={styles.confirmBody}>{undoCopy[order.status] ?? "Step this order back one stage?"}</p>
          {error &&
            (() => {
              // A blocked un-pick names the advanced backorder child — make its
              // ref tappable when it matches the child we know from the events.
              const m = error.match(/^blocked: finish or cancel backorder (\S+) first/);
              if (m && backorderChild && backorderChild.ref === m[1]) {
                return (
                  <p className={styles.error}>
                    Blocked — finish or cancel backorder{" "}
                    <Link href={`${detailBase}/${backorderChild.id}`} className={styles.parentLink}>
                      {backorderChild.ref}
                    </Link>{" "}
                    first.
                  </p>
                );
              }
              return <p className={styles.error}>{error}</p>;
            })()}
          <div className={styles.editActions}>
            <Button variant="secondary" onClick={() => setConfirmUndo(false)}>
              Keep as is
            </Button>
            <Button variant="destructive" onClick={handleUndo} loading={saving || isPending}>
              <Glyph icon={Undo2} />
              Undo
            </Button>
          </div>
        </BottomSheet>
      )}

      {confirmCancel && (
        <BottomSheet onClose={() => setConfirmCancel(false)}>
          <p className={styles.confirmTitle}>Cancel {order.orderRef}?</p>
          {isStaff ? (
            <>
              <label className={styles.notesLabel}>REASON (required)</label>
              <textarea
                className={styles.notesInput}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. shop backed out"
              />
            </>
          ) : (
            <p className={styles.confirmBody}>This can&apos;t be undone.</p>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.editActions}>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
              Keep order
            </Button>
            <Button variant="destructive-filled" onClick={handleCancel} loading={saving || isPending}>
              Cancel order
            </Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
