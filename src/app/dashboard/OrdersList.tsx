"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DateRange } from "react-day-picker";
import { createClient } from "@/lib/supabase/client";
import { StatusTag } from "@/components/ui/StatusTag";
import { getOrderStatusTag } from "@/lib/order-status";
import { formatOrderTimestamp, formatRupees, istDateKey } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { DEFAULT_RANGE } from "@/lib/date-range";
import { DateRangeFilter } from "./DateRangeFilter";
import { SalesmanFilter } from "./SalesmanFilter";
import type { DashboardOrderRow, SalesmanOption } from "./page";
import styles from "./OrdersList.module.css";

type StatusFilter = "all" | "submitted" | "processed" | "cancelled";

const ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, salesman_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name)";

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
  const [range, setRange] = useState<DateRange | undefined>(DEFAULT_RANGE);
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

    // Refetch (not patch-in-place) on UPDATE too — the raw payload lacks
    // joined fields like retailers(name, verified), so e.g. a retailer
    // verification wouldn't be reflected in the row until a manual refresh
    // (review flag ㉚.3).
    async function handleUpdate(orderId: string) {
      const { data } = await supabase.from("orders").select(ORDERS_SELECT).eq("id", orderId).maybeSingle();
      if (!data) return;
      const row = data as unknown as DashboardOrderRow;
      setOrders((prev) => prev.map((o) => (o.id === row.id ? row : o)));
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
        (payload) => void handleUpdate((payload.new as { id: string }).id),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const now = useMemo(() => new Date(tick), [tick]);

  // Bounded-initial-fetch seam: page.tsx currently fetches the last 300
  // orders unconditionally and everything below filters client-side — fine
  // at pilot scale, but the seam to swap in a server-side range query lives
  // right here if order volume ever outgrows a single client-side fetch.
  const q = query.trim().toLowerCase();

  // Two stages: `scoped` = everything except the status tab (drives the
  // per-tab counts below, so a count reflects the salesman/range/search
  // scope regardless of which tab is active); `finalFiltered` narrows that
  // by the active tab and is what the table/keyboard-nav actually render.
  const scoped = orders.filter((o) => {
    if (salesmanId !== "all" && o.salesman_id !== salesmanId) return false;
    if (range?.from) {
      const key = istDateKey(new Date(o.submitted_at));
      const fromKey = istDateKey(range.from);
      const toKey = istDateKey(range.to ?? range.from);
      if (key < fromKey || key > toKey) return false;
    }
    if (q) {
      const haystack = `${o.order_ref} ${o.retailers?.name ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const tabCounts: Record<StatusFilter, number> = {
    all: scoped.length,
    submitted: scoped.filter((o) => o.status === "submitted").length,
    processed: scoped.filter((o) => o.status === "processed").length,
    cancelled: scoped.filter((o) => o.status === "cancelled").length,
  };

  const finalFiltered = status === "all" ? scoped : scoped.filter((o) => o.status === status);

  // Derived, not effect-synced: a filter change can shrink the list out from
  // under a stale selectedIndex — clamp it for rendering/Enter instead of a
  // second setState round-trip.
  const safeIndex = finalFiltered.length === 0 ? -1 : Math.min(selectedIndex, finalFiltered.length - 1);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isFormField = target?.tagName === "INPUT" || target?.tagName === "SELECT" || target?.tagName === "TEXTAREA";

      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowDown" && !isFormField) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(finalFiltered.length - 1, i + 1));
      } else if (e.key === "ArrowUp" && !isFormField) {
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
              {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}{" "}
              <span className={styles.tabCount}>{tabCounts[s]}</span>
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <SalesmanFilter salesmen={salesmen} value={salesmanId} onChange={setSalesmanId} />
          <DateRangeFilter value={range} onChange={setRange} />
          <input
            ref={searchRef}
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ref or retailer (/)"
          />
        </div>
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
                    <td className={`${styles.mono} ${styles.cellMeta}`}>{formatOrderTimestamp(order.submitted_at, now)}</td>
                    <td className={styles.cellMeta}>{order.profiles?.full_name ?? "—"}</td>
                    <td className={styles.cellRetailer}>
                      {order.retailers?.name ?? "—"}
                      {order.retailers && !order.retailers.verified && <span className={styles.newBadge}>NEW</span>}
                    </td>
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
                    {order.profiles?.full_name ?? "—"}
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
