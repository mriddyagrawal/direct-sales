export type PriceParse = { ok: true; paise: number | null } | { ok: false; error: string };

// Parse a rupee price string into integer paise (M5.5). Accepts up to 2
// decimal places (₹557.5 → 55750); rejects >2 decimals and non-numeric.
// Blank ⇒ null (TBD / unpriced, D2). price_paise carries a CHECK (> 0), so
// zero/negative are rejected here too. Replaces the old whole-rupee
// `/^\d+$/` × 100 rule — the single source of truth for both the Add/Edit
// modal and the Excel import.
export function parsePricePaise(input: string): PriceParse {
  const t = input.trim();
  if (t === "") return { ok: true, paise: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Price must be a number." };
  const decimals = t.includes(".") ? t.split(".")[1].length : 0;
  if (decimals > 2) return { ok: false, error: "Price can have at most 2 decimal places." };
  const paise = Math.round(parseFloat(t) * 100);
  if (paise <= 0) return { ok: false, error: "Price must be greater than zero." };
  return { ok: true, paise };
}
