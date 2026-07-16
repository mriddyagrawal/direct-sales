import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewOrderFlow } from "./NewOrderFlow";

export interface ProductOption {
  id: string;
  category: string;
  name: string;
  tally_name: string; // model / Tally name; shown left of name when brand.show_model
  price_paise: number | null; // null for manual-pricing (LG) products — no catalog price
  brand_id: string;
  brand_name: string;
  pricing_mode: string; // 'fixed' | 'manual'
  show_model: boolean; // brand flag — render "{tally_name}・{name}" when true
  stock_qty: number | null; // godown stock from the last Tally sync; null = never synced
  stock_updated_at: string | null; // "as of" for the stock figure
}

export interface RetailerOption {
  id: string;
  name: string;
  area: string | null;
  verified: boolean;
}

export interface EditOrderData {
  id: string;
  retailerId: string;
  retailerName: string;
  retailerArea: string | null;
  notes: string;
  items: Record<string, number>;
  snapshotPrices: Record<string, number>; // existing lines' original unit_price_paise — the price at order time is the deal
  snapshotNames: Record<string, string>; // review flag ㉕ — a line whose product has since gone inactive/unpriced
                                          // won't be in the fetched catalog; carry its name so it still renders
                                          // (as removable, not orderable) instead of silently vanishing from the
                                          // list while still counted in the total and sent to update_order_items.
}

interface OrderItemRow {
  product_id: string;
  product_name: string;
  qty: number;
  unit_price_paise: number;
}

interface EditOrderRow {
  id: string;
  retailer_id: string;
  notes: string;
  status: string;
  editable_until: string;
  retailers: { name: string; area: string | null } | null;
  order_items: OrderItemRow[];
}

interface RecentOrderRow {
  retailer_id: string;
  submitted_at: string;
}

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Catalog = active AND priced only (RLS guarantees it, D2) — never render
  // an unpriced/inactive product; no extra filter needed here, just the
  // ordering the design spec wants (category groups, CSV order within them).
  const [{ data: productRows }, { data: retailerRows }, { data: recentRows }, { data: profile }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, category, name, tally_name, price_paise, brand_id, stock_qty, stock_updated_at, brands(name, pricing_mode, show_model)",
      )
      .order("category")
      .order("created_at"),
    supabase.from("retailers").select("id, name, area, verified").order("name"),
    supabase
      .from("orders")
      .select("retailer_id, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(30),
    supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
  ]);

  // Staff (accountant/admin) can also create orders from the dashboard FAB — so
  // "View order" on the confirmation must send them to the staff workbench
  // (/dashboard/orders/[id], with Approve), not the salesman lens (/orders/[id]).
  const isStaff = profile?.role === "admin" || profile?.role === "accountant";
  const isAdmin = profile?.role === "admin";
  const detailBase = isStaff ? "/dashboard/orders" : "/orders";

  const products = (
    (productRows ?? []) as unknown as Array<{
      id: string;
      category: string;
      name: string;
      tally_name: string;
      price_paise: number | null;
      brand_id: string;
      stock_qty: number | null;
      stock_updated_at: string | null;
      brands: { name: string; pricing_mode: string; show_model: boolean } | null;
    }>
  ).map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    tally_name: r.tally_name,
    price_paise: r.price_paise,
    brand_id: r.brand_id,
    brand_name: r.brands?.name ?? "",
    pricing_mode: r.brands?.pricing_mode ?? "fixed",
    show_model: r.brands?.show_model ?? false,
    stock_qty: r.stock_qty,
    stock_updated_at: r.stock_updated_at,
  })) as ProductOption[];
  const retailers = (retailerRows ?? []) as RetailerOption[];

  const seen = new Set<string>();
  const recentRetailerIds: string[] = [];
  for (const row of (recentRows ?? []) as RecentOrderRow[]) {
    if (!seen.has(row.retailer_id)) {
      seen.add(row.retailer_id);
      recentRetailerIds.push(row.retailer_id);
    }
    if (recentRetailerIds.length >= 8) break;
  }

  let editOrder: EditOrderData | null = null;
  // Admin post-approval edits demand a reason (edited_after_lock) — captured by
  // a BottomSheet on the final Confirm. Derived here so the flow only has to
  // obey the flag (a one-liner flip to "always for admin" lives in this gate).
  let requiresReason = false;
  if (edit) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, retailer_id, notes, status, editable_until, retailers(name, area), order_items(product_id, product_name, qty, unit_price_paise)",
      )
      .eq("id", edit)
      .maybeSingle();

    const row = data as unknown as EditOrderRow | null;
    // Who may edit which stage (owner matrix, unchanged): an ADMIN may edit any
    // non-cancelled order (reason required past approval); salesman & accountant
    // stay pending_approval-only (the 2h window is gone — owner 2026-07-11). RLS
    // scopes the salesman to his own rows and update_order_items re-enforces all
    // of this — this is only the UX gate that keeps the editor off a locked order.
    const editable = row && (isAdmin ? row.status !== "cancelled" : row.status === "pending_approval");
    if (!row || !editable) {
      redirect(`${detailBase}/${edit}`);
    }
    requiresReason = isAdmin && row.status !== "pending_approval";

    const items: Record<string, number> = {};
    const snapshotPrices: Record<string, number> = {};
    const snapshotNames: Record<string, string> = {};
    for (const item of row.order_items) {
      items[item.product_id] = item.qty;
      snapshotPrices[item.product_id] = item.unit_price_paise;
      snapshotNames[item.product_id] = item.product_name;
    }

    editOrder = {
      id: row.id,
      retailerId: row.retailer_id,
      retailerName: row.retailers?.name ?? "Unknown retailer",
      retailerArea: row.retailers?.area ?? null,
      notes: row.notes,
      items,
      snapshotPrices,
      snapshotNames,
    };
  }

  return (
    <NewOrderFlow
      products={products}
      retailers={retailers}
      recentRetailerIds={recentRetailerIds}
      editOrder={editOrder}
      salesmanId={user!.id}
      detailBase={detailBase}
      isAdmin={isAdmin}
      requiresReason={requiresReason}
    />
  );
}
