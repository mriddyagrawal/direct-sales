import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TopStrip } from "@/components/TopStrip";
import { BottomTabBar } from "@/components/BottomTabBar";
import styles from "./deposits.module.css";

// Deposits placeholder (orders-ui spec §6, owner decision #3): a LIVE,
// tappable tab that lands here today; the real deposits feature (~next month)
// replaces this page's content without touching the nav. Same salesman shell
// as the Orders list (top strip + bottom bar).
export default async function DepositsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className={styles.page}>
      <TopStrip accountLabel={profile?.full_name ?? user.email ?? ""} />
      <div className={styles.body}>
        <p className={styles.soon}>Coming soon!</p>
        <p className={styles.hint}>Deposit collection is on its way — for now, keep recording them the usual way.</p>
      </div>
      <BottomTabBar />
    </div>
  );
}
