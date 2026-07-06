import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { StatusTag } from "@/components/ui/StatusTag";
import { formatOrderTimestamp, formatRupees } from "@/lib/format";
import { getOrderStatusTag } from "@/lib/order-status";
import styles from "./dashboard.module.css";

interface OrderRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  total_paise: number;
  status: string;
  editable_until: string;
  retailers: { name: string; verified: boolean } | null;
  profiles: { full_name: string } | null;
  order_items: { count: number }[];
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No role/ownership filter here on purpose — orders_select_staff (RLS)
  // is what makes accountant/admin see every order, the same query shape
  // as the salesman Home read. RLS is the wall, not this query.
  const { data } = await supabase
    .from("orders")
    .select(
      "id, order_ref, submitted_at, total_paise, status, editable_until, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), order_items(count)",
    )
    .order("submitted_at", { ascending: false });

  const orders = (data ?? []) as unknown as OrderRow[];
  const now = new Date();

  return (
    <div className={styles.page}>
      <header className={styles.chrome}>
        <div className={styles.brand}>
          <Image src="/icon.png" alt="" width={24} height={24} />
          <span className={styles.brandName}>GANPATI ENTERPRISES</span>
        </div>
        <nav className={styles.tabs}>
          <span className={styles.tabActive}>Orders</span>
          {/* Retailers (S11 verification queue) is M5 — not wired yet. */}
          <span className={styles.tabDisabled}>Retailers</span>
        </nav>
        <div className={styles.account}>
          {user?.email} · <SignOutButton />
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Orders</h1>
          <span className={styles.count}>
            {orders.length} {orders.length === 1 ? "order" : "orders"}
          </span>
        </div>

        {orders.length === 0 ? (
          <p className={styles.empty}>No orders yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>REF</th>
                <th>SUBMITTED</th>
                <th>SALESMAN</th>
                <th>RETAILER</th>
                <th className={styles.numeric}>LINES</th>
                <th className={styles.numeric}>TOTAL</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const status = getOrderStatusTag(order, now);
                return (
                  <tr key={order.id}>
                    <td className={styles.mono}>{order.order_ref}</td>
                    <td className={styles.mono}>{formatOrderTimestamp(order.submitted_at, now)}</td>
                    <td>{order.profiles?.full_name ?? "—"}</td>
                    <td>
                      {order.retailers?.name ?? "—"}
                      {order.retailers && !order.retailers.verified && (
                        <span className={styles.newBadge}>NEW</span>
                      )}
                    </td>
                    <td className={[styles.mono, styles.numeric].join(" ")}>
                      {order.order_items?.[0]?.count ?? 0}
                    </td>
                    <td className={[styles.mono, styles.numeric].join(" ")}>
                      {formatRupees(order.total_paise)}
                    </td>
                    <td>
                      <StatusTag tone={status.tone} label={status.label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
