import { formatCountdown } from "@/lib/format";
import type { StatusTone } from "@/components/ui/StatusTag";

interface OrderForStatus {
  status: string;
  editable_until: string;
}

// Chip = status (design spec §2): the derived lock governs edit *permission*
// elsewhere, never which chip renders. A billed/cancelled order always shows
// its own chip regardless of the window. There is no 'submitted' anymore —
// every order is born pending_approval (lifecycle overhaul, 2026-07-10).
export function getOrderStatusTag(
  order: OrderForStatus,
  now: Date = new Date(),
): { tone: StatusTone; label: string; sublabel?: string } {
  if (order.status === "cancelled") return { tone: "error", label: "Cancelled" };
  if (order.status === "billed") return { tone: "billed", label: "Billed" };
  // Approved: admin-signed-off scan-brand (LG) order awaiting the godown —
  // neutral/ink, deliberately NOT the green of Billed. Label = "Pending pick"
  // (frontend only; the DB status stays `approved`). Fixed brands never hold
  // this status (they jump to ready_to_bill).
  if (order.status === "approved") return { tone: "locked", label: "Pending pick" };
  // Ready to bill: a fixed brand straight from approval, or LG post-pick —
  // awaiting the accountant's Tally entry. Accent (not green), still in flight.
  if (order.status === "ready_to_bill") return { tone: "accent", label: "Ready to bill" };

  // Pending approval — awaiting the admin (amber = "needs an eye"). The
  // salesman can still edit within the window (approval beats the timer),
  // but the chip is status, never edit-permission.
  if (order.status === "pending_approval") {
    const countdown = formatCountdown(order.editable_until, now);
    return { tone: "amber", label: "Pending approval", sublabel: countdown?.label };
  }
  // Unknown/legacy status — render it plainly rather than guessing.
  return { tone: "locked", label: order.status };
}
