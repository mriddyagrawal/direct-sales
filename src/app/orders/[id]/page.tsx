import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusTag } from "@/components/ui/StatusTag";
import { OrderActions } from "./OrderActions";
import { formatOrderTimestamp, formatRupees } from "@/lib/format";
import { getOrderStatusTag } from "@/lib/order-status";
import { describeEvent, type OrderEventRow } from "@/lib/order-events";
import styles from "./order-detail.module.css";

interface OrderItemRow {
  id: string;
  product_name: string;
  unit_price_paise: number;
  qty: number;
  line_total_paise: number;
  position: number;
}

interface RawEventRow {
  id: number;
  action: string;
  actor_id: string | null;
  details: unknown;
  created_at: string;
  profiles: { full_name: string } | null;
}

interface OrderDetailRow {
  id: string;
  order_ref: string;
  status: string;
  notes: string;
  total_paise: number;
  submitted_at: string;
  editable_until: string;
  processed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  salesman_id: string;
  retailers: { name: string; area: string | null; phone: string | null } | null;
  brands: { name: string; code: string } | null;
  order_items: OrderItemRow[];
  order_events: RawEventRow[];
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_ref, status, notes, total_paise, submitted_at, editable_until, processed_at, cancelled_at, cancelled_by, salesman_id, retailers(name, area, phone), brands(name, code), order_items(id, product_name, unit_price_paise, qty, line_total_paise, position), order_events(id, action, actor_id, details, created_at, profiles!order_events_actor_id_fkey(full_name))",
    )
    .eq("id", id)
    .maybeSingle();

  const order = data as unknown as OrderDetailRow | null;
  if (!order) notFound();

  const now = new Date();
  const status = getOrderStatusTag(order, now);
  const isOwner = order.salesman_id === user!.id;
  // A pending_approval order (manual/LG brand) stays salesman-editable within
  // the window — approval beats the timer (Phase 3b).
  const editable =
    (order.status === "submitted" || order.status === "pending_approval") && new Date(order.editable_until) > now;

  const items = [...order.order_items].sort((a, b) => a.position - b.position);
  const events: OrderEventRow[] = order.order_events
    .map((e) => ({
      id: e.id,
      action: e.action,
      actor_id: e.actor_id,
      actor_name: e.profiles?.full_name ?? null,
      details: e.details,
      created_at: e.created_at,
    }))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.ref}>{order.order_ref}</p>
          <p className={styles.subline}>
            {order.brands ? `${order.brands.name.toUpperCase()} · ` : ""}SUBMITTED{" "}
            {formatOrderTimestamp(order.submitted_at, now).toUpperCase()}
          </p>
        </div>
        <StatusTag tone={status.tone} label={status.label} />
      </div>

      <div className={styles.content}>
        {order.retailers && (
          <div className={styles.card}>
            <p className={styles.retailerName}>{order.retailers.name}</p>
            {order.retailers.area && <p className={styles.retailerMeta}>{order.retailers.area}</p>}
            {order.retailers.phone && <p className={styles.retailerMetaMono}>{order.retailers.phone}</p>}
          </div>
        )}

        <div>
          {items.map((item) => (
            <div key={item.id} className={styles.line}>
              <div className={styles.lineInfo}>
                <p className={styles.lineName}>{item.product_name}</p>
                <p className={styles.lineQty}>
                  {item.qty} × {formatRupees(item.unit_price_paise)}
                </p>
              </div>
              <span className={styles.lineAmount}>{formatRupees(item.line_total_paise)}</span>
            </div>
          ))}
          <div className={styles.totalRow}>
            <span>Total</span>
            <span className={styles.totalAmount}>{formatRupees(order.total_paise)}</span>
          </div>
        </div>

        {order.notes && (
          <div>
            <p className={styles.notesLabel}>NOTES FROM THE FIELD</p>
            <p className={styles.notes}>{order.notes}</p>
          </div>
        )}

        {order.status === "pending_approval" && (
          <p className={styles.noteLocked}>
            Waiting for office approval{editable ? " — you can still edit until the window closes." : "."}
          </p>
        )}
        {order.status === "approved" && (
          <p className={styles.noteProcessed}>Approved by the office — waiting to be processed.</p>
        )}

        {isOwner && editable && <OrderActions orderId={order.id} />}

        {isOwner && !editable && (order.status === "submitted" || order.status === "processed" || order.status === "cancelled") ? (
          <p className={order.status === "cancelled" ? styles.noteCancelled : order.status === "processed" ? styles.noteProcessed : styles.noteLocked}>
            {order.status === "processed"
              ? "Booked into Tally by the office. For any change, call the accountant."
              : order.status === "cancelled"
                ? `Cancelled ${formatOrderTimestamp(order.cancelled_at ?? order.submitted_at, now)}${order.cancelled_by === user!.id ? " — by you." : " — by the office."}`
                : "The edit window has ended. Call the accountant to change this order."}
          </p>
        ) : null}

        <div>
          <p className={styles.historyLabel}>HISTORY</p>
          {events.map((event) => (
            <p key={event.id} className={styles.historyLine}>
              {describeEvent(event, user!.id)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
