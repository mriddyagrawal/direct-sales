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
  if (order.status === "processed") return { tone: "processed", label: "Processed" };

  const countdown = formatCountdown(order.editable_until, now);
  if (countdown) {
    return {
      tone: countdown.urgent ? "amber" : "accent",
      label: `Submitted · ${countdown.label}`,
    };
  }
  return { tone: "locked", label: "Submitted · locked" };
}
