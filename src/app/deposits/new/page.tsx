import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DepositFlow } from "./DepositFlow";
import type { RetailerOption } from "@/app/new-order/page";
import { RETAILER_SELECT } from "@/lib/queries/retailers";

// New deposit (owner design 2026-07-19): a tiny flow — retailer → amount →
// method (+ optional note) → save. EDIT MODE REMOVED (owner 2026-09-02):
// deposits are corrected by void + re-record, never edited; update_deposit is
// dropped from the DB. returnTo is role-aware, mirroring new-order's
// detailBase.
export default async function NewDepositPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = profile?.role ?? "";
  // Role-aware landing: staff → dashboard, godown → their own shell's tab
  // (owner 2026-09-01 — godown records counter collections), else salesman.
  const returnTo =
    role === "admin" || role === "accountant" ? "/dashboard/deposits" : role === "godown" ? "/godown/deposits" : "/deposits";

  const [{ data: retailerRows }, { data: recentRows }] = await Promise.all([
    // RETAILER_SELECT, never a hand-typed list: this page casts the result to
    // RetailerOption, so a column missing from the select is a LIE the compiler
    // cannot catch. It was "id, name, area, verified" and the picker's row now
    // reads outstanding_paise — which arrived as undefined, failed the
    // `=== null` test, and rendered "₹NaN" in red on all 623 rows, on the screen
    // used to record money just collected. (REVIEWER, blocking, 2026-08-01.)
    supabase.from("retailers").select(RETAILER_SELECT).order("name"),
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

  return (
    <DepositFlow
      retailers={(retailerRows ?? []) as RetailerOption[]}
      recentRetailerIds={recentRetailerIds}
      salesmanId={user.id}
      returnTo={returnTo}
    />
  );
}
