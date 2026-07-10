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
  // Backorder — the remainder split off a partial pick, awaiting a Punch Order
  // to re-enter the pipeline. Violet, editable until punched.
  if (order.status === "backorder") return { tone: "backorder", label: "Backorder" };
  // Approved: admin-signed-off, awaiting the godown pick — ALL brands hold this
  // now (the Stage-1 fulfilment overhaul routes every brand here, not just LG;
  // fixed brands no longer skip to ready_to_bill). Neutral/ink, deliberately NOT
  // the green of Billed. Label = "Pending scan" (owner's choice; frontend only —
  // the DB status stays `approved`).
  if (order.status === "approved") return { tone: "locked", label: "Pending scan" };
  // Ready to bill: post-pick — any brand now goes approved → godown pick → here
  // — awaiting the accountant's Tally entry. Accent (not green), still in flight.
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
