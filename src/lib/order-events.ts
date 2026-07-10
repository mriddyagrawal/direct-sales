import { formatOrderTimestamp } from "@/lib/format";

// M5.5 swapped the audit-payload key from `sku` (dropped) to `tally_name`.
// Old order_events retain their `sku` key; new ones carry `tally_name` — read
// whichever is present so the whole history renders (order-lifecycle.md).
interface EventLine {
  tally_name?: string;
  sku?: string;
  qty: number;
  unit_price_paise: number;
}

const lineLabel = (l: EventLine): string => l.tally_name ?? l.sku ?? "item";

export interface OrderEventRow {
  id: number;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  details: unknown;
  created_at: string;
}

function diffLines(before: EventLine[], after: EventLine[]): string {
  const beforeByKey = new Map(before.map((l) => [lineLabel(l), l]));
  const afterByKey = new Map(after.map((l) => [lineLabel(l), l]));
  const changes: string[] = [];

  for (const [key, afterLine] of afterByKey) {
    const beforeLine = beforeByKey.get(key);
    if (!beforeLine) {
      changes.push(`${key} added ×${afterLine.qty}`);
    } else if (beforeLine.qty !== afterLine.qty) {
      changes.push(`${key} qty ${beforeLine.qty}→${afterLine.qty}`);
    }
  }
  for (const [key] of beforeByKey) {
    if (!afterByKey.has(key)) changes.push(`${key} removed`);
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
    case "approved":
      return `${time} Approved by ${actorLabel}`;
    case "picked": {
      // details.lines = [{ name, ordered, picked }] — summarise as picked/ordered.
      const lines = (details.lines as { ordered?: number; picked?: number }[] | undefined) ?? [];
      const picked = lines.reduce((s, l) => s + (l.picked ?? 0), 0);
      const ordered = lines.reduce((s, l) => s + (l.ordered ?? 0), 0);
      const summary = ordered > 0 ? ` — ${picked}/${ordered} units` : "";
      return `${time} Picked by ${actorLabel}${summary}`;
    }
    case "backordered": {
      // On the child order (parent_ref present): its genesis. On the parent
      // (child_ref present): the split it produced.
      if (typeof details.parent_ref === "string") return `${time} Backordered from ${details.parent_ref}`;
      const ref = typeof details.child_ref === "string" ? details.child_ref : "a backorder";
      return `${time} Backordered → ${ref}`;
    }
    case "billed":
      return `${time} Billed by ${actorLabel}`;
    default:
      return `${time} ${event.action}`;
  }
}
