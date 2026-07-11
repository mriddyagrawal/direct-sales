import type { StatusTone } from "@/components/ui/StatusTag";

interface OrderForStatus {
  status: string;
}

// Chip = status (design spec §2): the derived lock governs edit *permission*
// elsewhere, never which chip renders. A billed/cancelled order always shows
// its own chip. There is no 'submitted' anymore — every order is born
// pending_approval (lifecycle overhaul, 2026-07-10). The 2h edit window is gone
// (2026-07-11), so `pending_approval` no longer carries an "editable" countdown.
export function getOrderStatusTag(
  order: OrderForStatus,
): { tone: StatusTone; label: string; sublabel?: string } {
  if (order.status === "cancelled") return { tone: "error", label: "Cancelled" };
  if (order.status === "billed") return { tone: "billed", label: "Billed" };
  // Backorder — the remainder split off a partial pick, awaiting a Punch Order
  // to re-enter the pipeline. Violet.
  if (order.status === "backorder") return { tone: "backorder", label: "Backorder" };
  // Approved: admin-signed-off, awaiting the godown pick — label "Pending scan"
  // (owner's choice; frontend only — the DB status stays `approved`).
  if (order.status === "approved") return { tone: "locked", label: "Pending scan" };
  // Ready to bill: post-pick — awaiting the accountant's Tally entry.
  if (order.status === "ready_to_bill") return { tone: "accent", label: "Ready to bill" };
  // Pending approval — awaiting the admin (amber = "needs an eye").
  if (order.status === "pending_approval") return { tone: "amber", label: "Pending approval" };
  // Unknown/legacy status — render it plainly rather than guessing.
  return { tone: "locked", label: order.status };
}
