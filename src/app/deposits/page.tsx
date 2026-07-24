import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { fetchDepositsList } from "@/lib/queries/deposits";
import { TopStrip } from "@/components/TopStrip";
import { BottomTabBar } from "@/components/BottomTabBar";
import { DepositsView } from "@/components/deposits/DepositsView";
import styles from "./deposits.module.css";

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

  // Deposits query via the shared builder (spec D12); prefetch → dehydrate
  // seeds the client cache (per-request query client, spec D2) and
  // DepositsView owns the data from there via useQuery.
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["deposits", "salesman"],
    queryFn: () => fetchDepositsList(supabase, "salesman"),
  });

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user.email ?? ""} />
      <div className={styles.scroll}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <DepositsView scope="salesman" role="salesman" />
        </HydrationBoundary>
      </div>
      <BottomTabBar />
    </div>
  );
}
