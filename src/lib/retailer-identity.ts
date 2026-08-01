// Shared retailer-identity rules — ONE copy, imported by both the office
// modal (dashboard/retailers/RetailerModal) and the salesman quick-add
// (new-order/PickRetailer). They must not drift: a client check that
// disagrees with the database's index lets the form pass a name Postgres then
// rejects, and the user sees a raw constraint error instead of a warning.

/**
 * Tracks the two unique indexes on `retailers`:
 *   lower(regexp_replace(btrim(<col>), '\s+', ' ', 'g'))
 * i.e. trim the ends, collapse every internal whitespace run to one space,
 * lowercase. Any change here must be considered against the DB index too.
 *
 * NOT byte-identical to that expression, and the gap is deliberate. Postgres
 * `btrim(x)` with one argument strips SPACES only, so a leading tab survives it
 * and then becomes a leading space when `\s+` collapses — while JS `.trim()`
 * removes it outright. `\s` also differs on NBSP: JS matches it, Postgres's ARE
 * does not, and NBSP arrives easily via paste from Excel. Measured 2026-08-01:
 *
 *   "\tShop A"   ->   norm() "shop a"   |   DB " shop a"
 *
 * So this can be STRICTER than the index: it may flag a clash the database would
 * actually accept. That direction is the safe one — the user sees a warning
 * instead of a surprise — and the opposite direction is caught by
 * mapRetailerSaveError below.
 *
 * Do NOT "fix" this by copying btrim's space-only behaviour. That would stop the
 * form trimming tabs and newlines, which is worse for a name a human typed. The
 * database is the odd one here; closing the gap properly means an index rebuilt
 * on btrim(x, E' \t\n\r'), which is a migration and not worth it for input this
 * rare.
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
