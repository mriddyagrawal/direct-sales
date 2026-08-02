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
  // The raw value, carried so a surface that needs FINER copy than the three
  // states can get it without re-deriving the rule. Order detail uses it to
  // tell a credit (Dr./Cr. accounting labels) from a square ₹0, both of which
  // are "clear" and both of which are green — the STATE stays binary, because
  // that is what colour is keyed on, and splitting it would have forced every
  // existing consumer to learn a fourth case.
  paise: number | null;
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
  if (paise === null) return { state: "unknown", text: "—", paise };
  // <= 0 is nothing to chase: square, or in credit because they paid ahead.
  if (paise <= 0) return { state: "clear", text: formatRupees(paise), paise };
  return { state: "owed", text: formatRupees(paise), paise };
}

// The LEDGER rendering — "₹84,320 Dr", as Tally prints it: marker trailing, no
// full stops (owner 2026-08-02). Lives here rather than in a view because it is
// now on two screens (order detail's hero and the Quick Order ribbon) and a
// second private copy is how the two start disagreeing.
//
// Cr takes the ABSOLUTE value: formatRupees(-4500000) is "-₹45,000", and
// "-₹45,000 Cr" states the opposite of what it means. A square ₹0 takes NEITHER
// marker — it is not a debit or a credit — and an unknown balance stays the
// bare em dash.
export function ledgerText(reading: BalanceReading): string {
  if (reading.state === "owed") return `${reading.text} Dr`;
  if (reading.paise !== null && reading.paise < 0) return `${formatRupees(Math.abs(reading.paise))} Cr`;
  return reading.text;
}
