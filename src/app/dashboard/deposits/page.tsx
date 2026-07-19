import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DepositsView, type DepositListRow } from "@/components/deposits/DepositsView";

const DEPOSITS_SELECT =
  "id, deposit_ref, amount_paise, method, note, created_at, editable_until, salesman_id, voided_at, void_reason, retailers(name), profiles!deposits_salesman_id_fkey(full_name)";

// Office deposits — end-of-day reconciliation (owner design 2026-07-19). RLS
// gives staff every deposit; the view's hero is the chosen day's per-method +
// per-salesman totals (the cash-count worksheet), the itemized list below.
// The ADMIN additionally taps a row to correct/void it (allowed past the
// 1-hour window — the RPCs gate it); the accountant's rows are read-only.
export default async function DashboardDepositsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin" && profile?.role !== "accountant") redirect("/dashboard");

  const { data: rows } = await supabase
    .from("deposits")
    .select(DEPOSITS_SELECT)
    .order("created_at", { ascending: false })
    .limit(1000);

  return (
    <DepositsView
      deposits={(rows ?? []) as unknown as DepositListRow[]}
      role="staff"
      isAdmin={profile.role === "admin"}
    />
  );
}
