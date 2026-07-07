import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewOrderFlow } from "./NewOrderFlow";

export interface ProductOption {
  id: string;
  category: string;
  name: string;
  sku: string;
  price_paise: number;
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
  const [{ data: productRows }, { data: retailerRows }, { data: recentRows }] = await Promise.all([
    supabase.from("products").select("id, category, name, sku, price_paise").order("category").order("created_at"),
    supabase.from("retailers").select("id, name, area, verified").order("name"),
    supabase
      .from("orders")
      .select("retailer_id, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(30),
  ]);

  const products = (productRows ?? []) as ProductOption[];
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
  if (edit) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, retailer_id, notes, status, editable_until, retailers(name, area), order_items(product_id, product_name, qty, unit_price_paise)",
      )
      .eq("id", edit)
      .maybeSingle();

    const row = data as unknown as EditOrderRow | null;
    const editable = row && row.status === "submitted" && new Date(row.editable_until) > new Date();
    if (!row || !editable) {
      redirect(`/orders/${edit}`);
    }

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
    />
  );
}
