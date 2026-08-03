import { createClient } from "@/lib/supabase/server";
import { RETAILER_SELECT, type RetailerRow } from "@/lib/queries/retailers";
import {
  fetchRetailerLedger,
  ledgerSinceDate,
  openingBalancePaise,
  LEDGER_SINCE_DEFAULT,
  type LedgerSince,
} from "@/lib/queries/ledger";
import { renderStatementPdfBuffer } from "./StatementPdf";
import { statementFileName } from "@/lib/statement-filename";

// Streams a shop's STATEMENT OF ACCOUNT as a real application/pdf.
//
// It lives on this NEUTRAL path, never under /dashboard/*, because the owner
// wants the salesman to hand a shopkeeper their statement in the shop — and
// middleware fences salesmen out of /dashboard/*. Same reasoning the pick-slip
// route records for itself at /orders/[id]/pdf.
//
// @react-pdf/renderer needs Node, not edge.
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // ⚠️ THE RETAILER IS FETCHED FIRST, AND THAT ORDER IS THE ACCESS CONTROL.
  // `ledger_entries_select_all` is `auth_profile_role() IS NOT NULL`, so the
  // ledger table scopes NOTHING — every signed-in role can read every entry for
  // every shop. The retailer row is the only boundary
  // (retailers_select_salesman is active-only → no row → 404). A route that
  // queried the ledger by id first would hand any signed-in user any shop's
  // statement as a downloadable file, which is worse than the on-screen
  // version because it leaves the building.
  const { data } = await supabase.from("retailers").select(RETAILER_SELECT).eq("id", id).maybeSingle();
  const retailer = data as RetailerRow | null;
  if (!retailer) return new Response("Not found", { status: 404 });

  // A shop Tally never matched has no balance to foot to, so there is no
  // statement to produce — and printing a confident Rs 0 would be a lie. The
  // on-screen page says "not in the last sync"; here the honest answer is no
  // document at all.
  if (retailer.outstanding_paise === null) {
    return new Response("This shop has no Tally ledger linked, so it has no statement.", { status: 404 });
  }

  // Follows the on-screen filter: pressing Export while looking at one window
  // and getting another is surprising. Anything unrecognised falls back to the
  // page's own default rather than erroring.
  const raw = new URL(request.url).searchParams.get("since");
  const since: LedgerSince =
    raw === "3M" || raw === "6M" || raw === "FY" || raw === "ALL" ? raw : LEDGER_SINCE_DEFAULT;

  const entries = await fetchRetailerLedger(supabase, id, ledgerSinceDate(since));

  // Same derivation the screen uses, so the document and the page agree:
  // opening = outstanding − Σ(debit − credit) over the rows shown.
  const opening = openingBalancePaise(retailer.outstanding_paise, entries) ?? 0;

  const buffer = await renderStatementPdfBuffer({
    retailerName: retailer.name,
    area: retailer.area,
    phone: retailer.phone,
    entries,
    outstandingPaise: retailer.outstanding_paise,
    openingPaise: opening,
    balanceAsOf: retailer.balance_as_of,
    printedAtIso: new Date().toISOString(),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${statementFileName(retailer.name)}"`,
      // A statement is a point-in-time document and the balance moves nightly;
      // never let a proxy or the browser hand back yesterday's.
      "Cache-Control": "no-store",
    },
  });
}
