import { createClient } from "@/lib/supabase/server";
import { OrderCard } from "@/components/OrderCard";
import { BottomTabBar } from "@/components/BottomTabBar";
import { SignOutButton } from "@/components/SignOutButton";
import { PendingOrdersStrip } from "@/components/PendingOrdersStrip";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  // No .eq('salesman_id', ...) here on purpose — the orders_select_own RLS
  // policy already scopes this to the caller's own rows. Same query shape
  // as the accountant/admin dashboard; RLS is what makes the two return
  // different rows, not client-side filtering.
  //
  // D8 (decisions.md): a *self*-cancelled order is hidden from this list —
  // it almost always corrects a mistake and should read as "never
  // happened." An office-cancelled order (cancelled_by is the accountant/
  // admin, not this salesman) stays visible — that's real news, not noise.
  // `status.neq.cancelled` alone already covers every non-cancelled order
  // regardless of cancelled_by; the second clause only decides which
  // *cancelled* orders survive.
  const { data } = await supabase
    .from("orders")
    .select("id, order_ref, submitted_at, total_paise, status, editable_until, retailers(name), order_items(count)")
    .or(`status.neq.cancelled,cancelled_by.neq.${user!.id}`)
    .order("submitted_at", { ascending: false });

  const orders = (data ?? []) as unknown as OrderRow[];
  const now = new Date();

  return (
    <div className={styles.page}>
      <PendingOrdersStrip />
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
                  id={order.id}
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
        Signed in as {profile?.full_name ?? user?.email} · <SignOutButton />
      </div>

      <BottomTabBar />
    </div>
  );
}
