import { createClient } from "@/lib/supabase/server";
import { RetailersQueue } from "./RetailersQueue";

export interface RetailerRow {
  id: string;
  name: string;
  area: string | null;
  phone: string | null;
  verified: boolean;
  active: boolean;
}

// S11 — retailer verification queue. accountant/admin have RLS ALL on
// retailers (roles-and-permissions.md), so edits go through a direct
// RLS-scoped update, not an RPC — retailers aren't in the RPC-only
// category that orders/order_items/order_events are.
export default async function RetailersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("retailers")
    .select("id, name, area, phone, verified, active")
    .order("created_at", { ascending: false });

  return <RetailersQueue initialRetailers={(data ?? []) as RetailerRow[]} />;
}
