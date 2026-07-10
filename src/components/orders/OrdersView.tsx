"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import type { DateRange } from "react-day-picker";
import { createClient } from "@/lib/supabase/client";
import { StatusTag } from "@/components/ui/StatusTag";
import { getOrderStatusTag } from "@/lib/order-status";
import { formatOrderTimestamp, formatRupees, istDateKey } from "@/lib/format";
import { nowMs } from "@/lib/cart";
import { DEFAULT_RANGE } from "@/lib/date-range";
import { DateRangeFilter } from "./DateRangeFilter";
import { SalesmanFilter } from "./SalesmanFilter";
import { BrandFilter } from "./BrandFilter";
import styles from "./OrdersView.module.css";

export interface OrderListRow {
  id: string;
  order_ref: string;
  submitted_at: string;
  total_paise: number;
  status: string;
  editable_until: string;
  cancelled_by: string | null;
  salesman_id: string;
  brand_id: string;
  retailers: { name: string; verified: boolean } | null;
  profiles: { full_name: string } | null;
  brands: { name: string; code: string } | null;
}

export interface SalesmanOption {
  id: string;
  full_name: string;
}

export interface BrandOption {
  id: string;
  name: string;
}

type StatusFilter = "all" | "backorder" | "pending_approval" | "approved" | "ready_to_bill" | "billed" | "cancelled";

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  backorder: "Backorder",
  pending_approval: "Pending approval",
  approved: "Pending scan",
  ready_to_bill: "Ready to bill",
  billed: "Billed",
  cancelled: "Cancelled",
};

const ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)";

interface OrdersViewProps {
  initialOrders: OrderListRow[];
  salesmen: SalesmanOption[];
  brands: BrandOption[];
  role: "salesman" | "staff";
  currentUserId: string;
}

// THE orders list — one component, every role (unification, owner decision
// 2026-07-10). Same tabs/search/date-range/Realtime for everyone; RLS decides
// which rows exist (staff see all salesmen, a salesman only himself), and the
// role prop decides the extras: staff get the SALESMAN + BRAND filters and
// the salesman column; the salesman gets neither (they're all him) and D8
// self-cancel hiding. New rows arrive via Supabase Realtime (postgres_changes
// on `orders`, RLS-scoped) within the 5s budget; updates patch in place.
export function OrdersView({ initialOrders, salesmen, brands, role, currentUserId }: OrdersViewProps) {
  const isStaff = role === "staff";
  const detailBase = isStaff ? "/dashboard/orders" : "/orders";
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [salesmanId, setSalesmanId] = useState("all");
  const [brandId, setBrandId] = useState("all");
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

    // D8: a salesman's own self-cancelled order reads as "never happened" —
    // the page query excludes it, and this keeps Realtime from re-adding it.
    function hiddenByD8(row: OrderListRow) {
      return !isStaff && row.status === "cancelled" && row.cancelled_by === currentUserId;
    }

    async function handleInsert(orderId: string) {
      const { data } = await supabase.from("orders").select(ORDERS_SELECT).eq("id", orderId).maybeSingle();
      if (!data) return;
      const row = data as unknown as OrderListRow;
      if (hiddenByD8(row)) return;
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
      const row = data as unknown as OrderListRow;
      if (hiddenByD8(row)) {
        // Just self-cancelled from another tab/device — drop it from the list.
        setOrders((prev) => prev.filter((o) => o.id !== row.id));
        return;
      }
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
    // isStaff/currentUserId are stable props — this resubscribes only if the
    // role somehow changed under us (it can't; belt and suspenders for lint).
  }, [isStaff, currentUserId]);

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
  // Brand UI only appears once ≥2 brands are orderable — with a single brand
  // (Zebronics-only) the ledger is unchanged (no BRAND column/filter noise).
  const multiBrand = brands.length >= 2;

  const scoped = orders.filter((o) => {
    if (salesmanId !== "all" && o.salesman_id !== salesmanId) return false;
    if (brandId !== "all" && o.brand_id !== brandId) return false;
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
    backorder: scoped.filter((o) => o.status === "backorder").length,
    all: scoped.length,
    pending_approval: scoped.filter((o) => o.status === "pending_approval").length,
    approved: scoped.filter((o) => o.status === "approved").length,
    ready_to_bill: scoped.filter((o) => o.status === "ready_to_bill").length,
    billed: scoped.filter((o) => o.status === "billed").length,
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
        router.push(`${detailBase}/${finalFiltered[safeIndex].id}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalFiltered, safeIndex]);

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        {/* "My orders" for the salesman (every row is his); "Orders" for staff. */}
        <h1 className={styles.title}>{isStaff ? "Orders" : "My orders"}</h1>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterTabs}>
          {(["all", "backorder", "pending_approval", "approved", "ready_to_bill", "billed", "cancelled"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.filterTab} ${status === s ? styles.filterTabActive : ""}`}
              onClick={() => setStatus(s)}
            >
              {STATUS_LABEL[s]} <span className={styles.tabCount}>{tabCounts[s]}</span>
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          {/* SALESMAN/BRAND filters are staff-only — a salesman's rows are all
              his own (RLS). They share one explicit half-half row on mobile
              (the wrapper is display:contents on desktop, so the desktop flex
              row is untouched). */}
          {isStaff && (
            <div className={styles.filterHalves}>
              <SalesmanFilter salesmen={salesmen} value={salesmanId} onChange={setSalesmanId} />
              {multiBrand && <BrandFilter brands={brands} value={brandId} onChange={setBrandId} />}
            </div>
          )}
          <div className={styles.filterFull}>
            <DateRangeFilter value={range} onChange={setRange} />
          </div>
          <div className={styles.searchWrap}>
            <Glyph icon={Search} size={14} />
            <input
              ref={searchRef}
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ref or retailer"
            />
          </div>
        </div>
      </div>

      {finalFiltered.length === 0 ? (
        <p className={styles.empty}>
          {!isStaff && orders.length === 0
            ? "No orders yet — take your first order — tap New Order below"
            : "No orders match these filters."}
        </p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>REF</th>
                <th>SUBMITTED</th>
                {isStaff && <th>SALESMAN</th>}
                {multiBrand && <th>BRAND</th>}
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
                    onClick={() => router.push(`${detailBase}/${order.id}`)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <td className={styles.mono}>{order.order_ref}</td>
                    <td className={`${styles.mono} ${styles.cellMeta}`}>{formatOrderTimestamp(order.submitted_at, now)}</td>
                    {isStaff && <td className={styles.cellMeta}>{order.profiles?.full_name ?? "—"}</td>}
                    {multiBrand && <td className={styles.cellMeta}>{order.brands?.name ?? "—"}</td>}
                    <td className={styles.cellRetailer}>
                      {order.retailers?.name ?? "—"}
                      {order.retailers && !order.retailers.verified && <span className={styles.newBadge}>NEW</span>}
                    </td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{formatRupees(order.total_paise)}</td>
                    <td>
                      <StatusTag tone={tag.tone} label={tag.label} sublabel={tag.sublabel} />
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
                /* Spec §2: ref = mono grey eyebrow + chip; retailer + amount
                   are the two BOLD scan targets; ONE grey meta line
                   (salesman·time for staff, time only for the salesman — and
                   no brand: the ref eyebrow already carries the brand code).
                   pending_approval = amber left edge ("needs a human");
                   cancelled = struck amount. */
                <button
                  key={order.id}
                  type="button"
                  className={`${styles.card} ${order.status === "pending_approval" ? styles.cardPending : ""} ${newIds.has(order.id) ? styles.rowNew : ""}`}
                  onClick={() => router.push(`${detailBase}/${order.id}`)}
                >
                  <div className={styles.cardEyebrow}>
                    <span className={styles.cardRef}>{order.order_ref}</span>
                    <StatusTag tone={tag.tone} label={tag.label} sublabel={tag.sublabel} />
                  </div>
                  <div className={styles.cardMain}>
                    <span className={styles.cardRetailer}>
                      {order.retailers?.name ?? "—"}
                      {order.retailers && !order.retailers.verified && <span className={styles.newBadge}>NEW</span>}
                    </span>
                    <span
                      className={`${styles.cardAmount} ${order.status === "cancelled" ? styles.cardAmountStruck : ""}`}
                    >
                      {formatRupees(order.total_paise)}
                    </span>
                  </div>
                  <div className={styles.cardMeta}>
                    {isStaff && <>{order.profiles?.full_name ?? "—"} · </>}
                    {formatOrderTimestamp(order.submitted_at, now)}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <p className={styles.footerHint}>/ search · ↑↓ move · ↵ open</p>

      {/* New Order is a floating FAB for BOTH roles (spec §2) — it left the
          salesman bottom bar. The .page bottom padding keeps it off the last
          card. */}
      <Link href="/new-order" className={styles.fab}>
        <Glyph icon={Plus} />
        New Order
      </Link>
    </div>
  );
}
