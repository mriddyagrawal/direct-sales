import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/DashboardNav";
import styles from "./dashboard-layout.module.css";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  return (
    <div className={styles.shell}>
      <DashboardNav accountLabel={profile?.full_name ?? user?.email ?? ""} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
