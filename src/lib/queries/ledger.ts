import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { istDateKey } from "@/lib/format";

// THE retailer ledger query — spec D12 shape, beside retailers.ts and orders.ts.
// One shop's entries from `retailer_ledger_entries`, the table the nightly Tally
// sync writes.
//
// ⚠️ THIS QUERY SCOPES NOTHING. `ledger_entries_select_all` is
// `auth_profile_role() IS NOT NULL`, so every signed-in role can read every
// entry for every shop. The 404 for a shop a salesman may not see comes from
// the RETAILER row (retailers_select_salesman is active-only → maybeSingle() →
// notFound()), which is why the page must fetch the retailer FIRST and never
// reach here if that came back empty.

export interface LedgerEntryRow {
  id: number;
  // A DATE column, so this is "YYYY-MM-DD" with no time and no zone.
  entry_date: string;
  // Tally's own string, rendered verbatim — never translated, never
  // case-normalised. "Ganpati Payment" is 30 entries and every one is a DEBIT,
  // so a friendly label like "Receipt" would state the opposite of the truth.
  voucher_type: string;
  voucher_no: string | null;
  debit_paise: number;
  credit_paise: number;
}

export const LEDGER_SELECT = "id, entry_date, voucher_type, voucher_no, debit_paise, credit_paise";

// The statement filter is a START DATE ONLY — never a from/to range.
//
// That is forced by the page's design rather than being a simplification: the
// closing figure is only the CURRENT outstanding if the window ends today.
// Filter to June-alone and the total at the bottom stops matching the balance
// at the top, and the page's whole argument — stated above, proved below —
// collapses into two numbers that disagree.
export type LedgerSince = "3M" | "6M" | "FY" | "ALL";

export const LEDGER_SINCE_PRESETS: { value: LedgerSince; label: string }[] = [
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "FY", label: "This FY" },
  { value: "ALL", label: "All" },
];

// Default 6M, not This FY: in April a financial-year filter shows almost
// nothing, and an empty statement on a shop that has entries reads as broken.
export const LEDGER_SINCE_DEFAULT: LedgerSince = "6M";

// The start date for a preset, as "YYYY-MM-DD", or null for ALL (no filter).
//
// Everything is computed in IST via istDateKey, because entry_date is a plain
// DATE written from Tally's own calendar day. Using the browser's local day
// would put a phone in another zone a day out at the window edge.
//
// "This FY" mirrors _fy_start() in tally-agent/ledger_sync.py — "1 April of the
// financial year containing d", i.e. this year's 1 April from April onwards,
// last year's before it. The sync already computes it that way; this must not
// invent a second rule.
export function ledgerSinceDate(preset: LedgerSince, now: Date = new Date()): string | null {
  if (preset === "ALL") return null;

  const today = istDateKey(now); // "YYYY-MM-DD" in IST
  const [year, month, day] = today.split("-").map(Number);

  if (preset === "FY") {
    const fyYear = month >= 4 ? year : year - 1;
    return `${fyYear}-04-01`;
  }

  // Month arithmetic on the IST calendar date. Date.UTC keeps it off the local
  // zone entirely, and JS rolls an overflowing day back for us — 31 August
  // minus 6 months is 31 February, which becomes 3 March. That is the
  // conventional reading of "6 months ago" and, either way, an entry a day or
  // two either side of the boundary changes only which rows are shown, never
  // the arithmetic: the opening balance absorbs whatever falls outside.
  const months = preset === "3M" ? 3 : 6;
  const start = new Date(Date.UTC(year, month - 1 - months, day));
  return start.toISOString().slice(0, 10);
}

// OLDEST first (owner 2026-08-04, a change of convention rather than a fix —
// newest-first was coherent and shipped that way deliberately).
//
// The page's claim is that the balance is PROVED by the working, and a proof
// has to be legible in order: opening → bills → receipts → closing, the
// arithmetic running down the page. Newest-first made the reader assemble the
// sum bottom-up. It is also the universal statement-of-account convention, so
// the screen and the exported PDF now read the same way with no mental flip
// between them.
//
// The accepted cost: on a shop with years of entries this opens far from
// today's activity. The filter is what makes that survivable — the default is
// 6M, and "All" is an explicit opt-in where scrolling is expected.
//
// The id tiebreak keeps same-day entries in a stable order; without it
// PostgREST is free to return them differently between requests, and a list
// that reshuffles on a refetch looks like data changing.
export async function fetchRetailerLedger(
  supabase: SupabaseClient<Database>,
  retailerId: string,
  since: string | null,
): Promise<LedgerEntryRow[]> {
  let query = supabase
    .from("retailer_ledger_entries")
    .select(LEDGER_SELECT)
    .eq("retailer_id", retailerId)
    .order("entry_date", { ascending: true })
    .order("id", { ascending: true });

  if (since) query = query.gte("entry_date", since);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LedgerEntryRow[];
}

// The opening balance: what the shop owed BEFORE the window starts.
//
//   opening = outstanding − Σ(debit − credit) over the shown entries
//
// Derived client-side from data the page already holds — no query, no DB work.
// It MOVES when the filter moves, which is correct: it answers "what did they
// owe before this window", and a different window is a different question.
//
// Null outstanding (a shop Tally never matched) has no derivable opening, and
// null is not 0.
export function openingBalancePaise(
  outstandingPaise: number | null,
  entries: LedgerEntryRow[],
): number | null {
  if (outstandingPaise === null) return null;
  const movement = entries.reduce((sum, e) => sum + e.debit_paise - e.credit_paise, 0);
  return outstandingPaise - movement;
}
