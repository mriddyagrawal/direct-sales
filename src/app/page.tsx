import { createClient } from "@/lib/supabase/server";
import { OrderCard } from "@/components/OrderCard";
import { BottomTabBar } from "@/components/BottomTabBar";
import { SignOutButton } from "@/components/SignOutButton";
import { formatSectionLabel } from "@/lib/format";
import { getOrderStatusTag } from "@/lib/order-status";
import styles from "./page.module.css";

interface OrderRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  total_paise: number;
  status: string;
  editable_until: string;
  retailers: { name: string } | null;
  order_items: { count: number }[];
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No .eq('salesman_id', ...) here on purpose — the orders_select_own RLS
  // policy already scopes this to the caller's own rows. Same query shape
  // as the accountant/admin dashboard; RLS is what makes the two return
  // different rows, not client-side filtering.
  const { data } = await supabase
    .from("orders")
    .select("id, order_ref, submitted_at, total_paise, status, editable_until, retailers(name), order_items(count)")
    .order("submitted_at", { ascending: false });

  const orders = (data ?? []) as unknown as OrderRow[];
  const now = new Date();

  return (
    <div className={styles.page}>
      {orders.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            No orders yet — take your first order — tap New Order below
          </p>
        </div>
      ) : (
        <div className={styles.content}>
          {orders.map((order, index) => {
            const label = formatSectionLabel(order.submitted_at, now);
            const previousLabel =
              index > 0 ? formatSectionLabel(orders[index - 1].submitted_at, now) : null;
            const showLabel = label !== previousLabel;
            const status = getOrderStatusTag(order, now);

            return (
              <div key={order.id}>
                {showLabel && <p className={styles.sectionLabel}>{label}</p>}
                <OrderCard
                  orderRef={order.order_ref}
                  totalPaise={order.total_paise}
                  retailerName={order.retailers?.name ?? "Unknown retailer"}
                  itemCount={order.order_items?.[0]?.count ?? 0}
                  statusTone={status.tone}
                  statusLabel={status.label}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.account}>
        Signed in as {user?.email} · <SignOutButton />
      </div>

      <BottomTabBar />
    </div>
  );
}
