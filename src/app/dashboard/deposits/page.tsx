import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { fetchDepositsList } from "@/lib/queries/deposits";
import { DepositsView } from "@/components/deposits/DepositsView";

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

  // Deposits query via the shared builder (spec D12); prefetch → dehydrate
  // seeds the client cache (per-request query client, spec D2).
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["deposits", "staff"],
    queryFn: () => fetchDepositsList(supabase, "staff"),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DepositsView scope="staff" role="staff" isAdmin={profile.role === "admin"} />
    </HydrationBoundary>
  );
}
