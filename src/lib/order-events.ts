import { formatOrderTimestamp } from "@/lib/format";

interface EventLine {
  sku: string;
  qty: number;
  unit_price_paise: number;
}

export interface OrderEventRow {
  id: number;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  details: unknown;
  created_at: string;
}

function diffLines(before: EventLine[], after: EventLine[]): string {
  const beforeBySku = new Map(before.map((l) => [l.sku, l]));
  const afterBySku = new Map(after.map((l) => [l.sku, l]));
  const changes: string[] = [];

  for (const [sku, afterLine] of afterBySku) {
    const beforeLine = beforeBySku.get(sku);
    if (!beforeLine) {
      changes.push(`${sku} added ×${afterLine.qty}`);
    } else if (beforeLine.qty !== afterLine.qty) {
      changes.push(`${sku} qty ${beforeLine.qty}→${afterLine.qty}`);
    }
  }
  for (const [sku] of beforeBySku) {
    if (!afterBySku.has(sku)) changes.push(`${sku} removed`);
  }

  return changes.length > 0 ? changes.join(", ") : "no line changes";
}

// Reconstructs order_events into plain words a person could read to a
// retailer over the phone (order-lifecycle.md's event catalog + S7's
// HISTORY). This is the dispute-resolution trail — never summarized away.
export function describeEvent(event: OrderEventRow, currentUserId: string): string {
  const time = formatOrderTimestamp(event.created_at);
  const actorIsSelf = event.actor_id === currentUserId;
  const actorLabel = actorIsSelf ? "you" : (event.actor_name ?? "the office");
  const details = (event.details ?? {}) as Record<string, unknown>;

  switch (event.action) {
    case "submitted":
      return `${time} Submitted by ${actorLabel}`;
    case "items_changed":
    case "edited_after_lock": {
      const before = (details.before as EventLine[] | undefined) ?? [];
      const after = (details.after as EventLine[] | undefined) ?? [];
      const label = event.action === "edited_after_lock" ? "Edited (after lock)" : "Edited";
      const reason = typeof details.reason === "string" ? ` · reason: ${details.reason}` : "";
      return `${time} ${label} — ${diffLines(before, after)}${reason}`;
    }
    case "cancelled": {
      const reason = typeof details.reason === "string" ? ` · reason: ${details.reason}` : "";
      return `${time} Cancelled by ${actorLabel}${reason}`;
    }
    case "processed":
      return `${time} Processed by ${actorLabel}`;
    default:
      return `${time} ${event.action}`;
  }
}
