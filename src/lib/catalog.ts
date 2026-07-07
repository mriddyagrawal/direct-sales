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
