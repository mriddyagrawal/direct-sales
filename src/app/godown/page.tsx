import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { formatOrderTimestamp } from "@/lib/format";
import { PreloadScanner } from "./PreloadScanner";
import styles from "./godown.module.css";

interface QueueItem {
  id: string;
  product_name: string;
  qty: number;
  position: number;
  products: { tally_name: string } | null;
}

interface QueueRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  retailers: { name: string; area: string | null } | null;
  brands: { show_model: boolean } | null;
  order_items: QueueItem[];
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

  // Price-free (godown guardrail): product name, qty, model (tally_name) only —
  // never rate/amount. show_model drives the "model・name" line for LG.
  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_ref, submitted_at, retailers(name, area), brands(show_model), order_items(id, product_name, qty, position, products(tally_name))",
    )
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
          {queue.map((order) => {
            const lines = [...(order.order_items ?? [])].sort((a, b) => a.position - b.position);
            const showModel = order.brands?.show_model ?? false;
            return (
              <Link key={order.id} href={`/godown/${order.id}`} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.ref}>{order.order_ref}</span>
                  <span className={styles.items}>
                    {lines.length} {lines.length === 1 ? "line" : "lines"}
                  </span>
                </div>
                <div className={styles.retailer}>
                  {order.retailers?.name ?? "Unknown retailer"}
                  {order.retailers?.area ? ` · ${order.retailers.area}` : ""}
                </div>
                <div className={styles.time}>{formatOrderTimestamp(order.submitted_at, now)}</div>

                {/* What to physically pull — qty + product, inside the card,
                    below a divider. LG shows "model・name" (like Quick Order);
                    fixed brands just the name. No prices ever. */}
                <div className={styles.pickList}>
                  {lines.map((it) => (
                    <div key={it.id} className={styles.pickLine}>
                      <span className={styles.pickQty}>{it.qty}×</span>
                      <span className={styles.pickName}>
                        {showModel && it.products?.tally_name && it.products.tally_name !== it.product_name ? (
                          <>
                            <span className={styles.pickModel}>{it.products.tally_name}</span>
                            {"・"}
                            {it.product_name}
                          </>
                        ) : (
                          it.product_name
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
