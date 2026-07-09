"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusTag } from "@/components/ui/StatusTag";
import { Button } from "@/components/ui/Button";
import { SharePdfButton } from "@/components/SharePdfButton";
import { Stepper } from "@/components/ui/Stepper";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { getOrderStatusTag } from "@/lib/order-status";
import { formatOrderTimestamp, formatRupees } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { describeEvent, type OrderEventRow } from "@/lib/order-events";
import { updateOrderItems, cancelOrder, processOrder, approveOrder } from "@/lib/order-rpcs";
import type { CatalogProduct } from "./page";
import styles from "./OrderWorkbench.module.css";

const UI_QTY_CAP = 999;

interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_paise: number;
  qty: number;
  line_total_paise: number;
  position: number;
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

interface WorkbenchOrderData {
  id: string;
  orderRef: string;
  status: string;
  notes: string;
  totalPaise: number;
  submittedAt: string;
  editableUntil: string;
  processedAt: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  salesmanName: string;
  processedByName: string | null;
  retailerName: string;
  retailerArea: string | null;
  retailerPhone: string | null;
  retailerVerified: boolean;
  brandName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  pickedAt: string | null;
  pickedByName: string | null;
}

interface OrderWorkbenchProps {
  order: WorkbenchOrderData;
  items: OrderItemRow[];
  events: RawEventRow[];
  catalog: CatalogProduct[];
  currentUserId: string;
  isAdmin: boolean;
}

// S9 — the accountant/admin workbench. One filled-accent action (Mark
// processed); Edit and Cancel are outline/destructive; Share PDF hands the
// generated A5 order copy to the share sheet (phone) or the browser's viewer
// (desktop). All writes go through the same RPCs the salesman app uses —
// this UI is a different lens on the same guards.
export function OrderWorkbench({ order, items: initialItems, events, catalog, currentUserId, isAdmin }: OrderWorkbenchProps) {
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
  // Matches the RPC's editable window: a pending_approval order is still
  // editable in-window (approval beats the timer), so no reason is demanded.
  const editable =
    (order.status === "submitted" || order.status === "pending_approval") && new Date(order.editableUntil) > now;
  const requiresReason = mode === "edit" && !editable;
  const statusTag = getOrderStatusTag({ status: order.status, editable_until: order.editableUntil }, now);

  const snapshotById = useMemo(() => {
    const map: Record<string, { name: string; price: number }> = {};
    for (const it of initialItems) map[it.product_id] = { name: it.product_name, price: it.unit_price_paise };
    return map;
  }, [initialItems]);
  const catalogById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const lines = Object.entries(items)
    .map(([productId, qty]) => {
      const snap = snapshotById[productId];
      const product = catalogById.get(productId);
      const name = snap?.name ?? product?.name ?? "Unknown product";
      const rate = snap?.price ?? product?.price_paise ?? 0;
      return { productId, qty, name, rate };
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
  const showSerials =
    (order.status === "ready_to_bill" || order.status === "processed") && serialGroups.length > 0;

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
    if (!cancelReason.trim()) {
      setError("Reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cancelOrder(order.id, cancelReason.trim());
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
      <Link href="/dashboard" className={styles.breadcrumb}>
        ← ORDERS
      </Link>

      <div className={styles.header}>
        <div>
          <p className={styles.ref}>{order.orderRef}</p>
          <p className={styles.byline}>
            by {order.salesmanName}
            {order.brandName && ` · ${order.brandName}`} · submitted {formatOrderTimestamp(order.submittedAt, now)}
            {editable && ` · editable until ${formatOrderTimestamp(order.editableUntil, now)}`}
            {order.status === "processed" &&
              order.processedAt &&
              ` · billed ${formatOrderTimestamp(order.processedAt, now)}${order.processedByName ? ` by ${order.processedByName}` : ""}`}
            {order.status === "cancelled" &&
              order.cancelledAt &&
              ` · cancelled ${formatOrderTimestamp(order.cancelledAt, now)}${order.cancelledByName ? ` by ${order.cancelledByName}` : ""}`}
            {order.status === "approved" &&
              order.approvedAt &&
              ` · approved ${formatOrderTimestamp(order.approvedAt, now)}${order.approvedByName ? ` by ${order.approvedByName}` : ""}`}
            {order.pickedAt &&
              ` · picked ${formatOrderTimestamp(order.pickedAt, now)}${order.pickedByName ? ` by ${order.pickedByName}` : ""}`}
          </p>
        </div>
        <StatusTag tone={statusTag.tone} label={statusTag.label} />
      </div>

      <div className={styles.actions}>
        {/* Approval is admin-only (approve_order + guard enforce it too). The
            accountant sees a pending order but no Approve button. */}
        {order.status === "pending_approval" && isAdmin && (
          <Button variant="primary" onClick={handleApprove} loading={saving || isPending}>
            Approve
          </Button>
        )}
        {/* Processable = submitted (fixed), approved (manual — the override
            path), or ready_to_bill (picked, serials in hand — the normal LG
            path). A pending order can't be processed until approved (RPC
            enforces it too). */}
        {(order.status === "submitted" || order.status === "approved" || order.status === "ready_to_bill") && (
          <Button variant="primary" onClick={() => setConfirmProcess(true)}>
            Mark billed
          </Button>
        )}
        {order.status !== "cancelled" && mode === "view" && (
          <Button variant="secondary" onClick={() => setMode("edit")}>
            Edit
          </Button>
        )}
        {order.status !== "cancelled" && (
          <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
            Cancel
          </Button>
        )}
        {/* Share-only pick slip (owner decision): the generated A5 PDF goes
            straight to the native share sheet on a phone; desktop opens the
            PDF route in the browser's own viewer. The preview page is gone. */}
        <SharePdfButton orderId={order.id} orderRef={order.orderRef} variant="ink" />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.body}>
        <div className={styles.main}>
          <p className={styles.sectionLabel}>ITEM · SNAPSHOT AT SUBMIT</p>
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
                <tr key={line.productId}>
                  <td>{line.name}</td>
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
            <span>{lines.length} LINES</span>
            <span className={styles.mono}>Total (incl. GST) {formatRupees(total)}</span>
          </div>

          {/* Godown hand-off: the scanned serials the accountant types into
              Tally (batch/lot field). Copy-all because they're re-keying. */}
          {showSerials && (
            <div className={styles.serialsBox}>
              <div className={styles.serialsHead}>
                <p className={styles.sectionLabel}>SERIALS / TRACKING</p>
                <button type="button" className={styles.copySerials} onClick={handleCopySerials}>
                  {copied ? "Copied ✓" : "Copy all"}
                </button>
              </div>
              {serialGroups.map((group) => (
                <div key={group.id} className={styles.serialGroup}>
                  <p className={styles.serialGroupName}>
                    {group.name} <span className={styles.serialCount}>×{group.serials.length}</span>
                  </p>
                  {group.serials.map((serial) => (
                    <p key={serial} className={styles.serialItem}>
                      {serial}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}

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
              <p className={styles.notesText}>{notes || "—"}</p>
            )}
          </div>

          <div className={styles.card}>
            <p className={styles.retailerName}>
              {order.retailerName}
              {!order.retailerVerified && <span className={styles.newBadge}>NEW</span>}
            </p>
            {order.retailerArea && <p className={styles.meta}>{order.retailerArea}</p>}
            {order.retailerPhone && <p className={styles.metaMono}>{order.retailerPhone}</p>}
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
          <label className={styles.notesLabel}>REASON (required)</label>
          <textarea
            className={styles.notesInput}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="e.g. shop backed out"
          />
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
