// One query, every role. RLS is what differentiates the rows a caller gets —
// the salesman resolves only his own orders (and zero order_item_scans rows;
// that table's SELECT policies are staff/godown-only, so the embed comes back
// [] for him, not an error). Both detail pages import this so the shape can
// never drift between roles again.
import type { OrderDetailData } from "./OrderDetailView";

export const ORDER_DETAIL_SELECT =
  "id, order_ref, status, notes, total_paise, submitted_at, editable_until, processed_at, tally_bill_no, cancelled_at, cancelled_by, approved_at, approved_by, picked_at, salesman_id, parent_order_id, " +
  "retailers(name, area, phone, verified), " +
  "salesman:profiles!orders_salesman_id_fkey(full_name), " +
  "processed_by_profile:profiles!orders_processed_by_fkey(full_name), " +
  "cancelled_by_profile:profiles!orders_cancelled_by_fkey(full_name), " +
  "approved_by_profile:profiles!orders_approved_by_fkey(full_name), " +
  "picked_by_profile:profiles!orders_picked_by_fkey(full_name), " +
  "parent_order:orders!parent_order_id(order_ref), " +
  "brands(name, code, show_model), " +
  "order_items(id, product_id, product_name, unit_price_paise, qty, line_total_paise, picked_qty, position, products(tally_name), order_item_scans(id, serial, scanned_at)), " +
  "order_events(id, action, actor_id, details, created_at, profiles!order_events_actor_id_fkey(full_name))";

export interface OrderDetailItemRow {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_paise: number;
  qty: number;
  line_total_paise: number;
  // Units actually picked (shipped). Null until the order is picked; the
  // ordered qty/line_total above stay the immutable placed snapshot.
  picked_qty: number | null;
  position: number;
  // The CURRENT product's model (display-only, like the pick slip) — the
  // snapshot product_name stays the display name of record.
  products: { tally_name: string } | null;
  order_item_scans: { id: string; serial: string; scanned_at: string }[];
}

export interface OrderDetailEventRow {
  id: number;
  action: string;
  actor_id: string | null;
  details: unknown;
  created_at: string;
  profiles: { full_name: string } | null;
}

export interface OrderDetailQueryRow {
  id: string;
  order_ref: string;
  status: string;
  notes: string;
  total_paise: number;
  submitted_at: string;
  editable_until: string;
  processed_at: string | null;
  tally_bill_no: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  picked_at: string | null;
  salesman_id: string;
  parent_order_id: string | null;
  parent_order: { order_ref: string } | null;
  retailers: { name: string; area: string | null; phone: string | null; verified: boolean } | null;
  salesman: { full_name: string } | null;
  processed_by_profile: { full_name: string } | null;
  cancelled_by_profile: { full_name: string } | null;
  approved_by_profile: { full_name: string } | null;
  picked_by_profile: { full_name: string } | null;
  brands: { name: string; code: string; show_model: boolean } | null;
  order_items: OrderDetailItemRow[];
  order_events: OrderDetailEventRow[];
}

export function toOrderDetailProps(row: OrderDetailQueryRow): {
  order: OrderDetailData;
  items: OrderDetailItemRow[];
  events: OrderDetailEventRow[];
} {
  return {
    order: {
      id: row.id,
      orderRef: row.order_ref,
      status: row.status,
      notes: row.notes,
      totalPaise: row.total_paise,
      submittedAt: row.submitted_at,
      editableUntil: row.editable_until,
      processedAt: row.processed_at,
      tallyBillNo: row.tally_bill_no,
      cancelledAt: row.cancelled_at,
      cancelledById: row.cancelled_by,
      cancelledByName: row.cancelled_by_profile?.full_name ?? null,
      salesmanId: row.salesman_id,
      parentOrderId: row.parent_order_id,
      parentOrderRef: row.parent_order?.order_ref ?? null,
      salesmanName: row.salesman?.full_name ?? "Unknown",
      processedByName: row.processed_by_profile?.full_name ?? null,
      retailerName: row.retailers?.name ?? "Unknown retailer",
      retailerArea: row.retailers?.area ?? null,
      retailerPhone: row.retailers?.phone ?? null,
      retailerVerified: row.retailers?.verified ?? true,
      brandName: row.brands?.name ?? null,
      showModel: row.brands?.show_model ?? false,
      approvedAt: row.approved_at,
      approvedByName: row.approved_by_profile?.full_name ?? null,
      pickedAt: row.picked_at,
      pickedByName: row.picked_by_profile?.full_name ?? null,
    },
    items: [...row.order_items].sort((a, b) => a.position - b.position),
    events: [...row.order_events].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
  };
}
