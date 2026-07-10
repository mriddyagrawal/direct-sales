"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, Copy, Pencil, Stamp, X } from "lucide-react";
import { StatusTag } from "@/components/ui/StatusTag";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { SharePdfButton } from "@/components/SharePdfButton";
import { Stepper } from "@/components/ui/Stepper";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { getOrderStatusTag } from "@/lib/order-status";
import { formatOrderTimestamp, formatRupees } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { describeEvent, type OrderEventRow } from "@/lib/order-events";
import { updateOrderItems, cancelOrder, processOrder, approveOrder } from "@/lib/order-rpcs";
import styles from "./OrderDetailView.module.css";

const UI_QTY_CAP = 999;

// Catalog rows for the staff inline "+ Add item" editor. The salesman page
// passes [] — his edits go through the Quick Order flow instead.
export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  price_paise: number | null;
  active: boolean;
}

interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_paise: number;
  qty: number;
  line_total_paise: number;
  position: number;
  products: { tally_name: string } | null;
  order_item_scans: { id: string; serial: string; scanned_at: string }[];
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
  totalPaise: number;
  submittedAt: string;
  editableUntil: string;
  processedAt: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancelledByName: string | null;
  salesmanId: string;
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
}

interface OrderDetailViewProps {
  order: OrderDetailData;
  items: OrderItemRow[];
  events: RawEventRow[];
  catalog: CatalogProduct[];
  currentUserId: string;
  role: "salesman" | "staff";
  isAdmin: boolean;
}

// THE order detail — one component, every role (unification, owner decision
// 2026-07-10). The role decides which ACTIONS render; the boilerplate
// (header, lines, total, serials, notes, retailer, history, Share PDF) is
// identical. Staff: Approve (admin) · Mark billed · inline Edit (+reason
// after lock) · Cancel with reason · serials panel. Salesman: Edit order
// (via the Quick Order flow) + Cancel while in-window, read-only after,
// plus the status guidance notes; no serials. Hiding a button is cosmetic —
// every write goes through the same role-guarded RPCs either way.
export function OrderDetailView({ order, items: initialItems, events, catalog, currentUserId, role, isAdmin }: OrderDetailViewProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [items, setItems] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const it of initialItems) map[it.product_id] = it.qty;
    return map;
  });
  const [notes, setNotes] = useState(order.notes);
  const [reason, setReason] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmProcess, setConfirmProcess] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tick] = useState(nowMs);

  const now = useMemo(() => new Date(tick), [tick]);
  const isStaff = role === "staff";
  const isOwner = order.salesmanId === currentUserId;
  // Matches the RPC's editable window: a pending_approval order is still
  // editable in-window (approval beats the timer), so no reason is demanded.
  const editable = order.status === "pending_approval" && new Date(order.editableUntil) > now;
  // The salesman may edit/cancel only his own order, only in-window (the
  // cancel_order/update_order_items RPCs enforce exactly this server-side).
  const salesmanActionable = !isStaff && isOwner && editable;
  const requiresReason = mode === "edit" && !editable;
  const statusTag = getOrderStatusTag({ status: order.status, editable_until: order.editableUntil }, now);

  const snapshotById = useMemo(() => {
    const map: Record<string, { name: string; price: number }> = {};
    for (const it of initialItems) map[it.product_id] = { name: it.product_name, price: it.unit_price_paise };
    return map;
  }, [initialItems]);
  const catalogById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  // Model + serials per original line (spec §3 ITEMS): the model is the
  // CURRENT product's tally_name (display-only); serials in scan order.
  // A line newly added in edit mode has neither yet.
  const lineExtraByProduct = useMemo(() => {
    const map = new Map<string, { model: string | null; serials: string[] }>();
    for (const it of initialItems) {
      map.set(it.product_id, {
        model: it.products?.tally_name ?? null,
        serials: [...it.order_item_scans]
          .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))
          .map((s) => s.serial),
      });
    }
    return map;
  }, [initialItems]);

  const lines = Object.entries(items)
    .map(([productId, qty]) => {
      const snap = snapshotById[productId];
      const product = catalogById.get(productId);
      const name = snap?.name ?? product?.name ?? "Unknown product";
      const rate = snap?.price ?? product?.price_paise ?? 0;
      const extra = lineExtraByProduct.get(productId);
      return { productId, qty, name, rate, model: extra?.model ?? null, serials: extra?.serials ?? [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = lines.reduce((sum, l) => sum + l.rate * l.qty, 0);

  const addQ = addQuery.trim().toLowerCase();
  const addable =
    addQ === ""
      ? []
      : catalog
          .filter((p) => p.active && p.price_paise !== null && !items[p.id])
          .filter((p) => p.name.toLowerCase().includes(addQ))
          .slice(0, 8);

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
  const showSerialRows = order.showModel && mode === "view";
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

  function handleQtyChange(productId: string, qty: number) {
    setItems((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  }

  function addItem(product: CatalogProduct) {
    setItems((prev) => ({ ...prev, [product.id]: 1 }));
    setAddQuery("");
  }

  function cancelEdit() {
    const map: Record<string, number> = {};
    for (const it of initialItems) map[it.product_id] = it.qty;
    setItems(map);
    setNotes(order.notes);
    setReason("");
    setError(null);
    setMode("view");
  }

  async function handleSave() {
    if (requiresReason && !reason.trim()) {
      setError("A reason is required to edit this order after its window has passed.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateOrderItems(order.id, notes, items, requiresReason ? reason.trim() : undefined);
      setMode("view");
      // Stay busy through the refresh (review flag ㉜(🅑)) — see
      // ProductsPricing.tsx note; same dead-gap shape here.
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

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

  async function handleProcess() {
    setSaving(true);
    setError(null);
    try {
      await processOrder(order.id);
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
        <Link href={isStaff ? "/dashboard" : "/"} className={styles.breadcrumb}>
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
          const metaParts = isStaff
            ? [order.retailerArea, order.retailerPhone, order.salesmanName]
            : [order.retailerArea];
          const meta = metaParts.filter(Boolean).join(" · ");
          return meta ? <p className={styles.heroMeta}>{meta}</p> : null;
        })()}
        {editable && (
          <p className={styles.byline}>editable until {formatOrderTimestamp(order.editableUntil, now)}</p>
        )}
      </div>

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
      {(order.status === "billed" || order.status === "cancelled") && (
        <SharePdfButton orderId={order.id} orderRef={order.orderRef} variant="primary" />
      )}
      {isStaff && order.status === "approved" && (
        <>
          <p className={styles.waitLine}>Waiting for the godown to scan serials.</p>
          {/* Owner call (2026-07-11): the approved→billed override is a WIDE
              accent button above the secondaries — not a quiet row item. */}
          <Button variant="primary" onClick={() => setConfirmProcess(true)}>
            <Glyph icon={Stamp} />
            Mark billed
          </Button>
        </>
      )}

      {/* SECONDARIES (glyph + label; Cancel red at the far end — spec §3/§5).
          Every write still goes through the role-guarded RPCs; hiding a
          button is cosmetic. Billed-cancel is ADMIN-only (owner decision #1);
          salesman self-cancel = own + pending + in-window (decision #2). */}
      <div className={styles.secondaries}>
        {isStaff && order.status !== "cancelled" && mode === "view" && (
          <Button variant="secondary" onClick={() => setMode("edit")}>
            <Glyph icon={Pencil} />
            Edit
          </Button>
        )}
        {salesmanActionable && (
          <Button variant="secondary" onClick={() => router.push(`/new-order?edit=${order.id}`)}>
            <Glyph icon={Pencil} />
            Edit
          </Button>
        )}
        {order.status !== "billed" && order.status !== "cancelled" && (
          <SharePdfButton orderId={order.id} orderRef={order.orderRef} variant="ink" />
        )}
        {((isStaff && (order.status === "billed" ? isAdmin : order.status !== "cancelled")) ||
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

      {error && !confirmCancel && !confirmProcess && <p className={styles.error}>{error}</p>}

      {/* Salesman guidance notes — what the status means for HIM and what
          happens next (ported verbatim from the old /orders/[id] page). */}
      {!isStaff && (
        <>
          {order.status === "pending_approval" && (
            <p className={styles.noteLocked}>
              Waiting for office approval{salesmanActionable ? " — you can still edit until the window closes." : "."}
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
                {mode === "edit" && <th />}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <Fragment key={line.productId}>
                  <tr>
                    <td>
                      {/* Model eyebrow (spec §3): show_model brands lead each
                          line with the mono model; both roles see it. */}
                      {order.showModel && line.model && line.model !== line.name && (
                        <span className={styles.modelEyebrow}>{line.model}</span>
                      )}
                      {line.name}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric}`}>
                      {mode === "edit" ? (
                        <Stepper
                          qty={line.qty}
                          max={UI_QTY_CAP}
                          onChange={(next) => handleQtyChange(line.productId, next)}
                          onTapQuantity={() => {}}
                        />
                      ) : (
                        line.qty
                      )}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{formatRupees(line.rate)}</td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{formatRupees(line.rate * line.qty)}</td>
                    {mode === "edit" && (
                      <td>
                        <button type="button" className={styles.remove} onClick={() => handleQtyChange(line.productId, 0)}>
                          ✕
                        </button>
                      </td>
                    )}
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
              ))}
            </tbody>
          </table>

          {mode === "edit" && (
            <div className={styles.addItem}>
              <input
                className={styles.addInput}
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="+ Add item — search name or SKU"
              />
              {addable.length > 0 && (
                <div className={styles.addResults}>
                  {addable.map((p) => (
                    <button key={p.id} type="button" className={styles.addResult} onClick={() => addItem(p)}>
                      <span>{p.name}</span>
                      <span className={styles.mono}>{formatRupees(p.price_paise ?? 0)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.totalRow}>
            <span>
              {lines.reduce((sum, l) => sum + l.qty, 0)} {lines.reduce((sum, l) => sum + l.qty, 0) === 1 ? "unit" : "units"}
            </span>
            <span className={styles.mono}>Total (incl. GST) {formatRupees(total)}</span>
          </div>


          {mode === "edit" && requiresReason && (
            <div className={styles.reasonField}>
              <label className={styles.notesLabel}>REASON (required — edit after lock)</label>
              <textarea
                className={styles.notesInput}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. shop called with a correction"
              />
            </div>
          )}

          {mode === "edit" && (
            <div className={styles.editActions}>
              <Button variant="secondary" onClick={cancelEdit}>
                Discard
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving || isPending}>
                Save changes
              </Button>
            </div>
          )}
        </div>

        <div className={styles.rail}>
          <div className={styles.notesBox}>
            <p className={styles.notesLabel}>NOTES FROM THE FIELD</p>
            {mode === "edit" ? (
              <textarea className={styles.notesInput} value={notes} onChange={(e) => setNotes(e.target.value)} />
            ) : (
              <p className={styles.notesText}>{notes || "— no notes —"}</p>
            )}
          </div>

          <div>
            <p className={styles.sectionLabel}>HISTORY</p>
            {events2.map((e) => (
              <p key={e.id} className={styles.historyLine}>
                {describeEvent(e, currentUserId)}
              </p>
            ))}
          </div>
        </div>
      </div>

      {confirmProcess && (
        <BottomSheet onClose={() => setConfirmProcess(false)}>
          <p className={styles.confirmTitle}>Mark {order.orderRef} billed?</p>
          <p className={styles.confirmBody}>The salesman&apos;s app goes read-only for this order immediately.</p>
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
