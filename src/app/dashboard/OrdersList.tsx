"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusTag } from "@/components/ui/StatusTag";
import { getOrderStatusTag } from "@/lib/order-status";
import { formatOrderTimestamp, formatRupees, istDateKey } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import type { DashboardOrderRow, SalesmanOption } from "./page";
import styles from "./OrdersList.module.css";

type StatusFilter = "all" | "submitted" | "processed" | "cancelled";
type DateFilter = "all" | "today" | "yesterday";

const ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), order_items(count)";

interface RawOrderUpdate {
  id: string;
  status: string;
  total_paise: number;
  editable_until: string;
  cancelled_by: string | null;
}

interface OrdersListProps {
  initialOrders: DashboardOrderRow[];
  salesmen: SalesmanOption[];
}

// S8 — live orders ledger. New rows arrive via Supabase Realtime (postgres_
// changes on `orders`, RLS-scoped) within acceptance criterion #1's 5s
// budget; updates (Mark processed / Cancel / Edit, from this dashboard or
// any other open one) patch the row in place, no manual refresh needed.
export function OrdersList({ initialOrders, salesmen }: OrdersListProps) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [salesmanId, setSalesmanId] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tick, setTick] = useState(nowMs);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setInterval(() => setTick(nowMs()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const supabase = createClient();

    async function handleInsert(orderId: string) {
      const { data } = await supabase.from("orders").select(ORDERS_SELECT).eq("id", orderId).maybeSingle();
      if (!data) return;
      const row = data as unknown as DashboardOrderRow;
      setOrders((prev) => (prev.some((o) => o.id === row.id) ? prev : [row, ...prev]));
      setNewIds((prev) => new Set(prev).add(row.id));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }, 5000);
    }

    function handleUpdate(raw: RawOrderUpdate) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === raw.id
            ? {
                ...o,
                status: raw.status,
                total_paise: raw.total_paise,
                editable_until: raw.editable_until,
                cancelled_by: raw.cancelled_by,
              }
            : o,
        ),
      );
    }

    const channel = supabase
      .channel("dashboard-orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => void handleInsert((payload.new as { id: string }).id),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => handleUpdate(payload.new as RawOrderUpdate),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const now = useMemo(() => new Date(tick), [tick]);
  const todayKey = istDateKey(now);
  const yesterdayKey = istDateKey(new Date(tick - 24 * 60 * 60 * 1000));

  const q = query.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (status !== "all" && o.status !== status) return false;
    if (salesmanId !== "all") {
      // profiles!orders_salesman_id_fkey doesn't carry the id in this select
      // shape — matched by name below via the salesmen list instead.
    }
    if (dateFilter !== "all") {
      const key = istDateKey(new Date(o.submitted_at));
      if (dateFilter === "today" && key !== todayKey) return false;
      if (dateFilter === "yesterday" && key !== yesterdayKey) return false;
    }
    if (q) {
      const haystack = `${o.order_ref} ${o.retailers?.name ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Salesman filter needs the id, so join by name against the fetched list
  // (the orders select embeds only full_name via the FK relationship).
  const salesmanName = salesmen.find((s) => s.id === salesmanId)?.full_name;
  const finalFiltered = salesmanName ? filtered.filter((o) => o.profiles?.full_name === salesmanName) : filtered;

  // Derived, not effect-synced: a filter change can shrink the list out from
  // under a stale selectedIndex — clamp it for rendering/Enter instead of a
  // second setState round-trip.
  const safeIndex = finalFiltered.length === 0 ? -1 : Math.min(selectedIndex, finalFiltered.length - 1);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(finalFiltered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && finalFiltered[safeIndex]) {
        router.push(`/dashboard/orders/${finalFiltered[safeIndex].id}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalFiltered, safeIndex]);

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Orders</h1>
        <span className={styles.liveTag}>LIVE</span>
        <span className={styles.count}>
          {finalFiltered.length} {finalFiltered.length === 1 ? "order" : "orders"}
        </span>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterTabs}>
          {(["all", "submitted", "processed", "cancelled"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.filterTab} ${status === s ? styles.filterTabActive : ""}`}
              onClick={() => setStatus(s)}
            >
              {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select className={styles.select} value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
          <option value="all">All salesmen</option>
          {salesmen.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <select className={styles.select} value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)}>
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
        </select>
        <input
          ref={searchRef}
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ref or retailer (/)"
        />
      </div>

      {finalFiltered.length === 0 ? (
        <p className={styles.empty}>No orders match these filters.</p>
      ) : (
        <>
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
              {finalFiltered.map((order, index) => {
                const tag = getOrderStatusTag(order, now);
                const rowClasses = [
                  index === safeIndex ? styles.rowSelected : "",
                  newIds.has(order.id) ? styles.rowNew : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr
                    key={order.id}
                    className={rowClasses}
                    onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <td className={styles.mono}>{order.order_ref}</td>
                    <td className={styles.mono}>{formatOrderTimestamp(order.submitted_at, now)}</td>
                    <td>{order.profiles?.full_name ?? "—"}</td>
                    <td>
                      {order.retailers?.name ?? "—"}
                      {order.retailers && !order.retailers.verified && <span className={styles.newBadge}>NEW</span>}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{order.order_items?.[0]?.count ?? 0}</td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{formatRupees(order.total_paise)}</td>
                    <td>
                      <StatusTag tone={tag.tone} label={tag.label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className={styles.cards}>
            {finalFiltered.map((order) => {
              const tag = getOrderStatusTag(order, now);
              return (
                <button
                  key={order.id}
                  type="button"
                  className={`${styles.card} ${newIds.has(order.id) ? styles.rowNew : ""}`}
                  onClick={() => router.push(`/dashboard/orders/${order.id}`)}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.mono}>{order.order_ref}</span>
                    <span className={styles.mono}>{formatRupees(order.total_paise)}</span>
                  </div>
                  <div className={styles.cardMeta}>
                    {order.retailers?.name ?? "—"}
                    {order.retailers && !order.retailers.verified && <span className={styles.newBadge}>NEW</span>} ·{" "}
                    {order.profiles?.full_name ?? "—"} · {order.order_items?.[0]?.count ?? 0} lines
                  </div>
                  <div className={styles.cardBottom}>
                    <span className={styles.mono}>{formatOrderTimestamp(order.submitted_at, now)}</span>
                    <StatusTag tone={tag.tone} label={tag.label} />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <p className={styles.footerHint}>/ search · ↑↓ move · ↵ open</p>
    </div>
  );
}
