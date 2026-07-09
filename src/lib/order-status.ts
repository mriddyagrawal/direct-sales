import { formatCountdown } from "@/lib/format";
import type { StatusTone } from "@/components/ui/StatusTag";

interface OrderForStatus {
  status: string;
  editable_until: string;
}

// Chip = status (design spec §2): the derived lock governs edit *permission*
// elsewhere, never which chip renders. A processed/cancelled order always
// shows its own chip regardless of the window.
export function getOrderStatusTag(
  order: OrderForStatus,
  now: Date = new Date(),
): { tone: StatusTone; label: string } {
  if (order.status === "cancelled") return { tone: "error", label: "Cancelled" };
  if (order.status === "processed") return { tone: "processed", label: "Billed" };
  // Approved (Phase 3b): admin-signed-off manual-brand order, salesman
  // read-only — neutral/ink, deliberately NOT the green of Processed.
  if (order.status === "approved") return { tone: "locked", label: "Approved" };
  // Ready to bill (godown fulfilment): picked + serials captured, awaiting
  // the accountant's Tally entry. Accent (not green) — still in flight, and
  // it behaves like approved for the salesman (read-only).
  if (order.status === "ready_to_bill") return { tone: "accent", label: "Ready to bill" };

  const countdown = formatCountdown(order.editable_until, now);
  // Pending approval (Phase 3b): awaiting the admin (amber = "needs an eye").
  // The salesman can still edit within the window (approval beats the timer),
  // but the chip is status, never edit-permission.
  if (order.status === "pending_approval") {
    return { tone: "amber", label: countdown ? `Pending approval · ${countdown.label}` : "Pending approval" };
  }
  if (countdown) {
    return {
      tone: countdown.urgent ? "amber" : "accent",
      label: `Submitted · ${countdown.label}`,
    };
  }
  return { tone: "locked", label: "Submitted · locked" };
}
