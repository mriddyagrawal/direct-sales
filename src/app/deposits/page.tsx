import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TopStrip } from "@/components/TopStrip";
import { BottomTabBar } from "@/components/BottomTabBar";
import { DepositsView, type DepositListRow } from "@/components/deposits/DepositsView";
import styles from "./deposits.module.css";

const DEPOSITS_SELECT =
  "id, deposit_ref, amount_paise, method, note, created_at, editable_until, salesman_id, voided_at, void_reason, retailers(name), profiles!deposits_salesman_id_fkey(full_name)";

// Salesman deposits — his personal collection ledger (owner design
// 2026-07-19): hero totals (Today · This week), his own day-grouped history
// (RLS scopes the query to salesman_id = him), a New-deposit FAB. Same phone
// shell as Orders. Staff land on the dashboard lens instead — this page's
// shell (top strip + bottom tab bar) is the salesman's.
export default async function DepositsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role === "admin" || profile?.role === "accountant") redirect("/dashboard/deposits");

  const { data: rows } = await supabase
    .from("deposits")
    .select(DEPOSITS_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user.email ?? ""} />
      <div className={styles.scroll}>
        <DepositsView deposits={(rows ?? []) as unknown as DepositListRow[]} role="salesman" />
      </div>
      <BottomTabBar />
    </div>
  );
}
