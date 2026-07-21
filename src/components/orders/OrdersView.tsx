"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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
  admin_comment: string | null;
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

type StatusFilter =
  | "all"
  | "backorder"
  | "pending_approval"
  | "approved"
  | "ready_to_bill"
  | "billed"
  | "dispatched"
  | "cancelled";

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  backorder: "Backorder",
  pending_approval: "Pending approval",
  approved: "Pending scan",
  ready_to_bill: "Ready to bill",
  billed: "Billed",
  dispatched: "Dispatched",
  cancelled: "Cancelled",
};

const ORDERS_SELECT =
  "id, order_ref, submitted_at, total_paise, status, editable_until, cancelled_by, admin_comment, salesman_id, brand_id, retailers(name, verified), profiles!orders_salesman_id_fkey(full_name), brands(name, code)";

// Filter state persisted across a navigation away-and-back (open an order, hit
// back — the tab/salesman/brand/date/search you had are still there). Kept in
// sessionStorage: sticky through a working session, clean on a fresh app open
// (a phone PWA is backgrounded/killed constantly — a filter silently surviving
// for days would leave someone stuck on a stale/empty view). Keyed per route
// so each list surface (salesman "/", staff "/dashboard", the godown pages)
// keeps its own. The DateRange's Dates ride as ISO strings.
interface PersistedFilters {
  query: string;
  status: StatusFilter;
  salesmanId: string;
  brandId: string;
  from: string | null;
  to: string | null;
}

// The five filters live in ONE reducer (not five useStates) so the on-mount
// restore is a single `dispatch` — the app's established resume-from-storage
// pattern (NewOrderFlow.RESUME_ON_MOUNT), which the `set-state-in-effect` lint
// rule allows, unlike a setState in an effect.
interface FilterState {
  query: string;
  status: StatusFilter;
  salesmanId: string;
  brandId: string;
  range: DateRange | undefined;
}

type FilterAction =
  | { type: "query"; value: string }
  | { type: "status"; value: StatusFilter }
  | { type: "salesman"; value: string }
  | { type: "brand"; value: string }
  | { type: "range"; value: DateRange | undefined }
  | { type: "restore"; patch: Partial<FilterState> };

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "query":
      return { ...state, query: action.value };
    case "status":
      return { ...state, status: action.value };
    case "salesman":
      return { ...state, salesmanId: action.value };
    case "brand":
      return { ...state, brandId: action.value };
    case "range":
      return { ...state, range: action.value };
    case "restore":
      return { ...state, ...action.patch };
    default:
      return state;
  }
}

interface OrdersViewProps {
  initialOrders: OrderListRow[];
  salesmen: SalesmanOption[];
  brands: BrandOption[];
  role: "salesman" | "staff" | "godown";
  currentUserId: string;
  // Godown routes reuse this list read-only: a per-route TITLE ("Dispatch" /
  // "History") and a STATUS SCOPE that locks the visible set (the godown bottom
  // bar is the status nav, so the chip-tabs are hidden there).
  title?: string;
  statusScope?: string[];
  // Explicit chip-tab set (e.g. the godown Home page: Pending scan / Ready to
  // bill / Billed / Dispatched). When given, these tabs render even for the
  // godown (whose single-status routes hide them); the first tab is the default.
  tabs?: string[];
}

// THE orders list — one component, every role (unification, owner decision
// 2026-07-10). Same tabs/search/date-range/Realtime for everyone; RLS decides
// which rows exist (staff see all salesmen, a salesman only himself), and the
// role prop decides the extras: staff get the SALESMAN + BRAND filters and
// the salesman column; the salesman gets neither (they're all him) and D8
// self-cancel hiding. New rows arrive via Supabase Realtime (postgres_changes
// on `orders`, RLS-scoped) within the 5s budget; updates patch in place.
export function OrdersView({ initialOrders, salesmen, brands, role, currentUserId, title, statusScope, tabs }: OrdersViewProps) {
  const isStaff = role === "staff";
  const isGodown = role === "godown";
  const detailBase = isStaff ? "/dashboard/orders" : isGodown ? "/godown/orders" : "/orders";
  // Chip-tabs to render: an explicit `tabs` set (any role) wins; otherwise the
  // full set for staff/salesman and none for the godown (its bottom bar is the
  // nav). STATUS_LABEL/tabCounts cover every value, so the cast is safe.
  const chipTabs =
    (tabs as StatusFilter[] | undefined) ??
    (isGodown
      ? []
      : (["all", "pending_approval", "approved", "ready_to_bill", "billed", "dispatched", "cancelled", "backorder"] as StatusFilter[]));
  const router = useRouter();
  // One persisted-filter bucket per list route (see PersistedFilters).
  const pathname = usePathname();
  const storageKey = `ganpati:orders-filters:${pathname}`;
  const [orders, setOrders] = useState(initialOrders);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  // Default active tab: the first chip when there's no "All" (godown Home), else "all".
  const [filters, dispatchFilter] = useReducer(filterReducer, chipTabs, (tabs): FilterState => ({
    query: "",
    status: tabs.length > 0 && !tabs.includes("all") ? tabs[0] : "all",
    salesmanId: "all",
    brandId: "all",
    range: DEFAULT_RANGE(), // lazy init runs once on mount → "now" captured fresh
  }));
  const { query, status, salesmanId, brandId, range } = filters;
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

  // Restore persisted filters ONCE on mount — in an effect, not the useState
  // initializer, so the first client render matches the server (defaults) and
  // never trips a hydration mismatch (sessionStorage is client-only). Each
  // value is validated against the CURRENT props before it's applied — a saved
  // salesman who's since been deactivated, or a status that isn't a live tab,
  // falls back to the default instead of stranding the user on an empty list.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<PersistedFilters>;
      const patch: Partial<FilterState> = {};
      if (typeof p.query === "string") patch.query = p.query;
      if (typeof p.status === "string" && chipTabs.includes(p.status as StatusFilter)) patch.status = p.status as StatusFilter;
      if (typeof p.salesmanId === "string" && (p.salesmanId === "all" || salesmen.some((s) => s.id === p.salesmanId)))
        patch.salesmanId = p.salesmanId;
      if (typeof p.brandId === "string" && (p.brandId === "all" || brands.some((b) => b.id === p.brandId)))
        patch.brandId = p.brandId;
      // The whole bucket is written together, so a present entry always carries
      // the range: both null = the user deliberately cleared it (→ undefined),
      // otherwise the saved dates.
      patch.range =
        p.from || p.to ? { from: p.from ? new Date(p.from) : undefined, to: p.to ? new Date(p.to) : undefined } : undefined;
      dispatchFilter({ type: "restore", patch });
    } catch {
      // Corrupt/blocked storage — ignore and keep the defaults.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every filter change. The first (mount) run is skipped so it can
  // never clobber a stored bucket with the defaults BEFORE the restore effect
  // above has read it — after that, each change writes through.
  const hydratedForWrite = useRef(false);
  useEffect(() => {
    if (!hydratedForWrite.current) {
      hydratedForWrite.current = true;
      return;
    }
    try {
      const payload: PersistedFilters = {
        query,
        status,
        salesmanId,
        brandId,
        from: range?.from ? range.from.toISOString() : null,
        to: range?.to ? range.to.toISOString() : null,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Storage disabled/full — non-fatal; filters just won't persist.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

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
    if (statusScope && !statusScope.includes(o.status)) return false;
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
    dispatched: scoped.filter((o) => o.status === "dispatched").length,
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
        <h1 className={styles.title}>{title ?? (isStaff ? "Orders" : "My orders")}</h1>
      </div>

      <div className={styles.filters}>
        {/* Chip-tabs: full set for staff/salesman; an explicit `tabs` set for the
            godown Home; hidden on the godown's single-status routes (Dispatch),
            whose bottom bar is the status nav. */}
        {chipTabs.length > 0 && (
          <div className={styles.filterTabs}>
            {chipTabs.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.filterTab} ${status === s ? styles.filterTabActive : ""}`}
                onClick={() => dispatchFilter({ type: "status", value: s })}
              >
                {STATUS_LABEL[s]} <span className={styles.tabCount}>{tabCounts[s]}</span>
              </button>
            ))}
          </div>
        )}
        <div className={styles.filterGroup}>
          {/* SALESMAN/BRAND filters are staff-only — a salesman's rows are all
              his own (RLS). They share one explicit half-half row on mobile
              (the wrapper is display:contents on desktop, so the desktop flex
              row is untouched). */}
          {isStaff && (
            <div className={styles.filterHalves}>
              <SalesmanFilter salesmen={salesmen} value={salesmanId} onChange={(value) => dispatchFilter({ type: "salesman", value })} />
              {multiBrand && <BrandFilter brands={brands} value={brandId} onChange={(value) => dispatchFilter({ type: "brand", value })} />}
            </div>
          )}
          <div className={styles.filterFull}>
            <DateRangeFilter value={range} onChange={(value) => dispatchFilter({ type: "range", value })} />
          </div>
          <div className={styles.searchWrap}>
            <Glyph icon={Search} size={14} />
            <input
              ref={searchRef}
              className={styles.search}
              value={query}
              onChange={(e) => dispatchFilter({ type: "query", value: e.target.value })}
              placeholder="Search ref or retailer"
            />
          </div>
        </div>
      </div>

      {finalFiltered.length === 0 ? (
        <p className={styles.empty}>
          {role === "salesman" && orders.length === 0
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
                const tag = getOrderStatusTag(order);
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
                      {order.admin_comment && order.status === "pending_approval" && (
                        <span className={styles.rowAdminNote}>⚠ {order.admin_comment}</span>
                      )}
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
              const tag = getOrderStatusTag(order);
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
                  {/* Admin's held-stage note — a red line every role sees, but
                      ONLY while pending_approval (hidden once it leaves the stage). */}
                  {order.admin_comment && order.status === "pending_approval" && (
                    <div className={styles.cardAdminNote}>⚠ {order.admin_comment}</div>
                  )}
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
      {/* No New Order FAB for the godown — it never creates orders. */}
      {!isGodown && (
        <Link href="/new-order" className={styles.fab}>
          <Glyph icon={Plus} />
          New Order
        </Link>
      )}
    </div>
  );
}
