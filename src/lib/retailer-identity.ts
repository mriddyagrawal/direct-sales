// Shared retailer-identity rules — ONE copy, imported by both the office
// modal (dashboard/retailers/RetailerModal) and the salesman quick-add
// (new-order/PickRetailer). They must not drift: a client check that
// disagrees with the database's index lets the form pass a name Postgres then
// rejects, and the user sees a raw constraint error instead of a warning.

/**
 * Mirrors BOTH unique indexes on `retailers` exactly:
 *   lower(regexp_replace(btrim(<col>), '\s+', ' ', 'g'))
 * i.e. trim the ends, collapse every internal whitespace run to one space,
 * lowercase. Any change here must be made in the DB index too.
 */
export function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The rule that makes "leave it blank" work (owner 2026-08-01): a blank Tally
 * ledger name stores the SHOP NAME, never null. `_apply_ledger` matches on
 * tally_ledger_name only — it has no fallback to `name` — so a row left null
 * would sync nothing, forever. The form is what fills the gap.
 *
 * `existing` is the row's current value on an EDIT: when it is already set we
 * keep it untouched, which is the rename safety this whole change exists for
 * (renaming the shop must not silently re-point its ledger link).
 */
export function resolveTallyLedgerName(typed: string, shopName: string, existing?: string | null): string {
  const t = typed.trim();
  if (t !== "") return t;
  const kept = (existing ?? "").trim();
  if (kept !== "") return kept;
  return shopName.trim();
}

/**
 * Postgres surfaces the violated index in the message; map the two we own to
 * something a human can act on. Anything else is returned as-is — an unknown
 * error must never be swallowed behind a friendly guess.
 */
export function mapRetailerSaveError(message: string): string {
  if (message.includes("retailers_name_norm_unique")) {
    return "Another shop already has this name. Search for it instead of adding it again.";
  }
  if (message.includes("retailers_tally_ledger_name_norm_unique")) {
    return "Another shop is already linked to that Tally ledger name.";
  }
  return message;
}

/** A shop whose normalised name collides with `candidate`, ignoring `excludeId`. */
export function findNameClash<T extends { id: string; name: string }>(
  candidate: string,
  rows: T[],
  excludeId?: string,
): T | null {
  const target = norm(candidate);
  if (target === "") return null;
  return rows.find((r) => r.id !== excludeId && norm(r.name) === target) ?? null;
}
