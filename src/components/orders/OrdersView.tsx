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

// The row shape + list query live in the shared builder (spec D12); the type
// is re-exported here so existing importers keep working.
import { fetchOrdersList, type OrderListRow, type OrdersScope } from "@/lib/queries/orders";
import { useQuery, useQueryClient } from "@tanstack/react-query";
export type { OrderListRow };

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
  // Which shared-builder scope this surface renders — also the cache key
  // (["orders", scope], spec D4). The server page prefetches the same scope
  // into a HydrationBoundary; this component then owns it via useQuery.
  scope: OrdersScope;
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
export function OrdersView({ scope, salesmen, brands, role, currentUserId, title, statusScope, tabs }: OrdersViewProps) {
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
  const queryClient = useQueryClient();
  // THE list (spec D10): this component renders ONLY from the query cache —
  // seeded by the server render (HydrationBoundary), corrected by background
  // refetches (mount / focus / reconnect, D6 defaults) and by the Realtime
  // invalidations below. The old useState(initialOrders) + render-phase
  // re-seed are gone: two writers into two stores was the flicker/race class
  // the spec kills; a router.refresh() now feeds this same cache via the
  // page's dehydrated payload instead of props. D13: render from data
  // presence (`?? []`) — a failed background refetch keeps the painted list;
  // never gate rendering on isError.
  const { data: orders = [] } = useQuery({
    queryKey: ["orders", scope],
    queryFn: () => fetchOrdersList(createClient(), scope, currentUserId),
  });
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  // Bumped to tear down + rebuild the Realtime channel after a failure.
  const [rtNonce, setRtNonce] = useState(0);
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

  // Salesman-filter options = the canonical salesmen UNION whoever actually
  // owns a loaded order. submit_order stamps salesman_id = the creator, so an
  // admin (or accountant) who creates/punches an order owns it — role-scoping
  // the list to 'salesman' would drop those orders from the filter entirely.
  // Names come off each order's profiles join; deriving from `orders` keeps it
  // fresh as Realtime adds rows. Additive: every canonical salesman still
  // appears. Defined here (above the restore effect) so the persisted-filter
  // validation can check against it too.
  const salesmanOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of salesmen) map.set(s.id, s.full_name);
    for (const o of orders) if (!map.has(o.salesman_id)) map.set(o.salesman_id, o.profiles?.full_name ?? "Unknown");
    return [...map.entries()]
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [salesmen, orders]);

  useEffect(() => {
    const id = setInterval(() => setTick(nowMs()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let hadFailure = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // D10 (spec v4): Realtime is an INVALIDATION SIGNAL, not a data writer —
    // every event marks ["orders"] stale (all scopes; inactive ones refetch on
    // their next mount) and the active list refetches through the one shared
    // builder, joins and D8 included. invalidateQueries' default cancelRefetch
    // aborts a stale in-flight response and reissues, so an event landing
    // mid-fetch can never be erased by an older snapshot — the v3 "convergence
    // rule" is this library default. At this order volume a bounded 300-row
    // refetch per event is noise; the old per-row fetch+patch into a second
    // store was the flicker/race class the spec kills.
    const invalidateOrders = () => void queryClient.invalidateQueries({ queryKey: ["orders"] });

    function handleInsert(row: { id: string; status: string; cancelled_by: string | null }) {
      // D8: a salesman's own self-cancel reads as "never happened" — the
      // builder's or-clause already excludes it from every refetch; skipping
      // the highlight just keeps a 5s glow off a row that won't render. The
      // raw payload carries these columns (no joins needed for this check).
      const hidden = !isStaff && row.status === "cancelled" && row.cancelled_by === currentUserId;
      if (!hidden) {
        setNewIds((prev) => new Set(prev).add(row.id));
        setTimeout(() => {
          setNewIds((prev) => {
            const next = new Set(prev);
            next.delete(row.id);
            return next;
          });
        }, 5000);
      }
      invalidateOrders();
    }

    // ROOT CAUSE (verified in realtime.subscription, 2026-07-24: every live
    // orders subscription carried claims_role=anon): the channel joined BEFORE
    // the user's JWT reached the socket, so RLS evaluated the listener as anon
    // — which has no SELECT on orders — and Realtime delivered ZERO events,
    // silently, on every platform. Attach the session token FIRST, then join;
    // the auth listener keeps the socket authorized across token refreshes.
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      supabase.realtime.setAuth(session?.access_token ?? null);
    });

    async function start() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      supabase.realtime.setAuth(session?.access_token ?? null);
      channel = supabase
        .channel("dashboard-orders")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "orders" },
          (payload) => handleInsert(payload.new as { id: string; status: string; cancelled_by: string | null }),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "orders" },
          // Joined fields (retailer name/verified …) ride the refetch, so an
          // update is just an invalidation (was review flag ㉚.3's refetch).
          () => invalidateOrders(),
        )
        .subscribe((status) => {
        // The old bare subscribe() swallowed failures — an auth hiccup or a
        // dropped socket (iOS suspends WebSockets whenever the PWA is
        // backgrounded) meant NO live orders, silently, until a manual reload
        // (owner-reported 2026-07-24). Now: log it, rebuild the channel after
        // a short pause, and re-pull the list on recovery to fill the gap.
          if (status === "SUBSCRIBED") {
            if (hadFailure) {
              hadFailure = false;
              invalidateOrders(); // catch up on events missed while dead
            }
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            hadFailure = true;
            console.warn(`orders realtime: ${status} — resubscribing in 4s`);
            if (retryTimer === null) {
              retryTimer = setTimeout(() => setRtNonce((n) => n + 1), 4000);
            }
          }
        });
    }
    void start();

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
    // isStaff/currentUserId/queryClient are stable; rtNonce forces a clean
    // rebuild after a failed/closed channel. The old visibilitychange/online
    // safety net is GONE on purpose (spec D6): TanStack's focusManager/
    // onlineManager re-fetch this query on foreground/reconnect already —
    // a second set of listeners would double-fetch and drift.
  }, [isStaff, currentUserId, rtNonce, queryClient]);

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
      if (typeof p.salesmanId === "string" && (p.salesmanId === "all" || salesmanOptions.some((s) => s.id === p.salesmanId)))
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

      {/* Chip-tabs: full set for staff/salesman; an explicit `tabs` set for the
          godown Home; hidden on the godown's single-status routes (Dispatch),
          whose bottom bar is the status nav. A DIRECT .page child, NOT inside
          .filters: position:sticky can never leave its parent's box, so as a
          .filters child the chips un-stuck as soon as the filter zone scrolled
          past (owner repro 2026-07-24) — as a page-level sibling they pin for
          the whole list. */}
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
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          {/* SALESMAN/BRAND filters are staff-only — a salesman's rows are all
              his own (RLS). They share one explicit half-half row on mobile
              (the wrapper is display:contents on desktop, so the desktop flex
              row is untouched). */}
          {isStaff && (
            <div className={styles.filterHalves}>
              <SalesmanFilter salesmen={salesmanOptions} value={salesmanId} onChange={(value) => dispatchFilter({ type: "salesman", value })} />
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
