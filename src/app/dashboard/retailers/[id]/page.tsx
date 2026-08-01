import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetailerDetail } from "./RetailerDetail";
import type { RetailerRow } from "../page";

// Retailer detail — the row-click destination for the office queue, replacing
// the modal that used to open in place (spec 2026-08-01). Deliberately minimal:
// identity, contact, status and the Tally ledger link, plus the edit action.
// The outstanding balance and the statement land here in the NEXT task; this
// page exists now so step 6's links have somewhere real to go.
//
// RLS (accountant/admin have ALL on retailers) is what scopes this read — the
// same superset columns the list already selects.
export default async function RetailerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("retailers")
    .select("id, name, area, phone, verified, active, tally_ledger_name, outstanding_paise")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  return <RetailerDetail retailer={data as RetailerRow} />;
}
