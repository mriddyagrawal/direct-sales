// Fold an entered category into an existing one for the same brand,
// case-insensitively after trimming — so "speakers" stores as the canonical
// existing "Speakers" rather than creating a near-duplicate. No match ⇒ keep
// the trimmed entry (a genuinely new category). Shared by the Add/Edit modal
// and the Excel import (M5.5).
export function normalizeCategory(entered: string, existing: string[]): string {
  const t = entered.trim();
  const hit = existing.find((c) => c.toLowerCase() === t.toLowerCase());
  return hit ?? t;
}

// The catalog key is (brand_id, tally_name); tally_name is always populated —
// a blank Tally-name field folds to the display name at save. This mirrors
// that rule for the import's diff/apply and the modal's save.
export function effectiveTallyName(tallyName: string, displayName: string): string {
  return tallyName.trim() || displayName.trim();
}

// Brands whose Tally items are named "<prefix><model>" while the manufacturer's
// PRICE LIST gives the bare model. LG's price lists ship model numbers like
// `GL-B257JPZ3`; the catalog holds `LG GL-B257JPZ3`, so without this every LG
// import matched nothing and the office pasted a CONCATENATE column into Excel
// before each one.
//
// Verified against prod 2026-08-08: 612 of 612 LG products are exactly
// `LG ` + model — uppercase, single space, no double spaces, no case variants,
// zero exceptions. That is what makes a literal prefix safe rather than a guess.
//
// A TABLE rather than an `if`, so the second brand is a one-line change.
//
// ACCEPTED COST, recorded because it is invisible: this keys on the brand's
// NAME. Renaming the brand in the DB silently switches the rule off — imports
// would quietly stop prefixing and start creating duplicates. Keying on the id
// would survive a rename but hardcodes a UUID into source; keying on the code
// would need the code to be loaded everywhere this is called. Neither is worth
// a DB change, so: if you rename a brand, check this table.
const BRAND_TALLY_PREFIX: Record<string, string> = {
  LG: "LG ",
};

export function brandTallyPrefix(brandName: string): string | null {
  return BRAND_TALLY_PREFIX[brandName] ?? null;
}

// Prefix a tally name for its brand, idempotently.
//
// CASE-SENSITIVE `startsWith`, deliberately, and NO folding anywhere near this
// path. The catalog key is `UNIQUE (brand_id, tally_name)` on the raw column and
// the wizard matches with an exact Map.get — so `LG gl-b257jpz3` is a different
// product from `LG GL-B257JPZ3`, and a mis-cased sheet row shows up in the
// preview as a NEW product. That is the correct failure direction on a key:
// a duplicate is visible and deletable, whereas a case-fold would silently
// overwrite a real product's price with no trace. Do not add a lower() here.
//
// An empty tally name returns unchanged — never a bare "LG ", which would be a
// key made of nothing but the prefix.
export function applyBrandTallyPrefix(brandName: string, tallyName: string): string {
  const prefix = brandTallyPrefix(brandName);
  if (!prefix || tallyName === "") return tallyName;
  return tallyName.startsWith(prefix) ? tallyName : prefix + tallyName;
}
