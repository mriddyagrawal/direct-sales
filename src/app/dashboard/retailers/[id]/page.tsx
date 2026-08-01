import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetailerDetail } from "@/components/retailers/RetailerDetail";
import { RETAILER_SELECT, type RetailerRow } from "@/lib/queries/retailers";

// Retailer detail — the row-click destination for the office queue, replacing
// the modal that used to open in place (spec 2026-08-01). Deliberately minimal:
// identity, contact, status and the Tally ledger link, plus the edit action.
//
// The STAFF lens on the shared RetailerDetail; /retailers/[id] is the salesman
// lens on the same component and the same select. RLS (accountant/admin have
// ALL on retailers) is what scopes this read.
export default async function RetailerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("retailers").select(RETAILER_SELECT).eq("id", id).maybeSingle();

  if (!data) notFound();

  return <RetailerDetail retailer={data as RetailerRow} role="staff" />;
}
