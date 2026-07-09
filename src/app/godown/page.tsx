import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { formatOrderTimestamp } from "@/lib/format";
import { PreloadScanner } from "./PreloadScanner";
import styles from "./godown.module.css";

interface QueueRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  retailers: { name: string; area: string | null } | null;
  order_items: { count: number }[];
}

// The godown pick queue — approved LG orders awaiting serial capture.
// NO price columns are selected anywhere on the godown surface (owner
// decision: prices hidden in UI; the queries don't even fetch them).
// RLS (orders_select_godown) already scopes rows to approved/ready_to_bill
// approval-brand orders; the .eq() narrows the queue to the ones still
// awaiting a pick.
export default async function GodownQueuePage() {
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
  // Page gate (middleware backstops this) — only the godown role belongs here.
  if (profile?.role !== "godown") redirect("/");

  const { data } = await supabase
    .from("orders")
    .select("id, order_ref, submitted_at, retailers(name, area), order_items(count)")
    .eq("status", "approved")
    .order("submitted_at", { ascending: false });

  const queue = (data ?? []) as unknown as QueueRow[];
  const now = new Date();

  return (
    <div className={styles.page}>
      <PreloadScanner />
      <header className={styles.header}>
        <span className={styles.brand}>GANPATI · GODOWN</span>
        <span className={styles.account}>
          {profile?.full_name ?? ""} · <SignOutButton />
        </span>
      </header>

      <div className={styles.queueHead}>
        <h1 className={styles.title}>To pick</h1>
        <span className={styles.count}>{queue.length}</span>
      </div>

      {queue.length === 0 ? (
        <p className={styles.empty}>Nothing to pick — approved orders will appear here.</p>
      ) : (
        <div className={styles.list}>
          {queue.map((order) => (
            <Link key={order.id} href={`/godown/${order.id}`} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.ref}>{order.order_ref}</span>
                <span className={styles.items}>
                  {order.order_items?.[0]?.count ?? 0} {(order.order_items?.[0]?.count ?? 0) === 1 ? "line" : "lines"}
                </span>
              </div>
              <div className={styles.retailer}>
                {order.retailers?.name ?? "Unknown retailer"}
                {order.retailers?.area ? ` · ${order.retailers.area}` : ""}
              </div>
              <div className={styles.time}>{formatOrderTimestamp(order.submitted_at, now)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
