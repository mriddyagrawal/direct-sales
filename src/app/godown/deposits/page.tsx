import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { fetchDepositsList } from "@/lib/queries/deposits";
import { DepositsView } from "@/components/deposits/DepositsView";
import { GodownTabBar } from "@/components/GodownTabBar";

// Godown DEPOSITS tab (owner 2026-09-01): the counter case — a retailer
// paying while collecting goods. The SAME personal-ledger lens as the
// salesman page (scope "salesman" = RLS's salesman_id = auth.uid(), which
// scopes to THIS worker's own entries; the shared cache key is fine because
// the cache is per-tab and auth-wiped, spec D4/D9) — inside the godown
// shell, not the salesman's, so the bottom tabs stay theirs.
export default async function GodownDepositsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "godown") redirect("/");

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["deposits", "salesman"],
    queryFn: () => fetchDepositsList(supabase, "salesman"),
  });

  return (
    <>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DepositsView scope="salesman" role="salesman" viewerId={user.id} />
      </HydrationBoundary>
      <GodownTabBar />
    </>
  );
}
