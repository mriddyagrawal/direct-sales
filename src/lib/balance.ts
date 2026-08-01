import { formatRupees } from "@/lib/format";

// THE balance rule — how a retailer's outstanding amount reads, once, for every
// surface that shows one.
//
// It was born inside RetailersQueue as `outstanding()`, whose own comment
// claimed "ONE definition of how a balance reads, so the table and the phone
// cards can never disagree". That claim only held while the queue was the only
// screen with a balance on it. The salesman's picker row and Retailers tab make
// it three and four, and a private copy on each would turn that comment into a
// lie — so the DECISION moves here and the copies never happen.
//
// It returns a semantic STATE, not a CSS class, because a class from one CSS
// module means nothing in another: `styles.amtOwed` is a hashed name scoped to
// its own stylesheet. Each surface maps the state to its own local class and
// keeps its own visual grammar (a table cell and a phone row are not styled the
// same), while the question "does this shop owe us money?" is answered in one
// place.
export type BalanceState = "owed" | "clear" | "unknown";

export interface BalanceReading {
  state: BalanceState;
  // Already formatted for display: rupees, en-IN. Never raw paise.
  text: string;
}

// `paise` is retailers.outstanding_paise, written by the nightly Tally sync.
// POSITIVE means the shop owes us.
//
// BINARY, never a threshold — the reading does not depend on HOW much is owed.
// Credit-limit tiers were deliberately dropped 2026-07-31 and must not creep
// back in here as a "large amount reads differently" scale.
export function readBalance(paise: number | null): BalanceReading {
  // NULL is "not in the last sync" — Tally matched nothing for this shop. It
  // must NEVER render as ₹0: zero is a real, square balance and a different
  // fact. Hence a dash, and a state its own surfaces leave UNcoloured, because
  // owed-red or clear-green would each be a claim we cannot make.
  if (paise === null) return { state: "unknown", text: "—" };
  // <= 0 is nothing to chase: square, or in credit because they paid ahead.
  if (paise <= 0) return { state: "clear", text: formatRupees(paise) };
  return { state: "owed", text: formatRupees(paise) };
}
