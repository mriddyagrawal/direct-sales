import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nowMs } from "@/lib/cart";
import { DepositFlow, type EditDepositData } from "./DepositFlow";
import type { RetailerOption } from "@/app/new-order/page";

// New / Edit deposit (owner design 2026-07-19): a tiny flow — retailer →
// amount → method (+ optional note) → save. Shared by the salesman (his
// /deposits FAB + in-window row edits) and the ADMIN (dashboard corrections,
// past the window too — update_deposit/delete_deposit re-check server-side).
// returnTo is role-aware, mirroring new-order's detailBase.
export default async function NewDepositPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = profile?.role ?? "";
  if (role === "godown") redirect("/godown");
  const isAdmin = role === "admin";
  const returnTo = role === "admin" || role === "accountant" ? "/dashboard/deposits" : "/deposits";

  const [{ data: retailerRows }, { data: recentRows }] = await Promise.all([
    supabase.from("retailers").select("id, name, area, verified").order("name"),
    // Recent = the shops he's collected from lately (deposit history, not orders).
    supabase.from("deposits").select("retailer_id, created_at").order("created_at", { ascending: false }).limit(30),
  ]);

  const seen = new Set<string>();
  const recentRetailerIds: string[] = [];
  for (const row of (recentRows ?? []) as { retailer_id: string }[]) {
    if (!seen.has(row.retailer_id)) {
      seen.add(row.retailer_id);
      recentRetailerIds.push(row.retailer_id);
    }
    if (recentRetailerIds.length >= 8) break;
  }

  let editDeposit: EditDepositData | null = null;
  if (edit) {
    const { data } = await supabase
      .from("deposits")
      .select("id, retailer_id, salesman_id, amount_paise, method, note, editable_until, voided_at, retailers(name, area)")
      .eq("id", edit)
      .maybeSingle();
    const row = data as unknown as {
      id: string;
      retailer_id: string;
      salesman_id: string;
      amount_paise: number;
      method: string;
      note: string | null;
      editable_until: string;
      voided_at: string | null;
      retailers: { name: string; area: string | null } | null;
    } | null;
    // The RPCs are the real gate; this is the UX mirror — a VOIDED row is
    // never editable; otherwise admin always, the creating salesman only
    // inside his 1-hour window. (RLS already hides other salesmen's rows →
    // row null → bounce.)
    const mayEdit =
      row &&
      row.voided_at === null &&
      (isAdmin || (row.salesman_id === user.id && nowMs() < new Date(row.editable_until).getTime()));
    if (!row || !mayEdit) redirect(returnTo);
    editDeposit = {
      id: row.id,
      retailerId: row.retailer_id,
      retailerName: row.retailers?.name ?? "Unknown retailer",
      retailerArea: row.retailers?.area ?? null,
      amountPaise: row.amount_paise,
      method: row.method,
      note: row.note ?? "",
    };
  }

  return (
    <DepositFlow
      retailers={(retailerRows ?? []) as RetailerOption[]}
      recentRetailerIds={recentRetailerIds}
      salesmanId={user.id}
      editDeposit={editDeposit}
      returnTo={returnTo}
    />
  );
}
