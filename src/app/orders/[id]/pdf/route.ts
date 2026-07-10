import { createClient } from "@/lib/supabase/server";
import { renderPickSlipPdfBuffer } from "./PickSlipPdf";

// Streams the ORDER COPY as a real application/pdf. Lives at the NEUTRAL
// /orders/[id]/pdf path on purpose: middleware fences salesmen out of
// /dashboard/*, and this PDF serves salesman, accountant, and admin alike —
// RLS scopes each caller to the orders they may see (no row → 404), so the
// route needs no role check of its own. @react-pdf/renderer needs Node, not
// edge.
export const runtime = "nodejs";

interface PdfItemRow {
  product_name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  position: number;
  products: { tally_name: string } | null;
  order_item_scans: { serial: string; scanned_at: string }[];
}

interface PdfOrderRow {
  order_ref: string;
  status: string;
  submitted_at: string;
  notes: string;
  total_paise: number;
  tally_bill_no: string | null;
  retailers: { name: string; area: string | null; phone: string | null } | null;
  salesman: { full_name: string } | null;
  brands: { name: string; code: string; show_model: boolean } | null;
  order_items: PdfItemRow[];
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Same RLS-scoped query as the pick-slip page — RLS IS the access gate:
  // a caller who can't see the order gets no row → 404. No service client.
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "order_ref, status, submitted_at, notes, total_paise, tally_bill_no, retailers(name, area, phone), salesman:profiles!orders_salesman_id_fkey(full_name), brands(name, code, show_model), order_items(product_name, qty, unit_price_paise, line_total_paise, position, products(tally_name), order_item_scans(serial, scanned_at))",
    )
    .eq("id", id)
    .maybeSingle();

  const order = data as unknown as PdfOrderRow | null;
  if (!order) {
    return new Response("Not found", { status: 404 });
  }

  const items = [...order.order_items]
    .sort((a, b) => a.position - b.position)
    .map((it) => ({
      product_name: it.product_name,
      qty: it.qty,
      unit_price_paise: it.unit_price_paise,
      line_total_paise: it.line_total_paise,
      tally_name: it.products?.tally_name ?? null,
      // Serials in scan order — same nesting as the on-screen order page.
      // Empty for fixed brands / unpicked orders (RLS scopes who sees them).
      serials: [...(it.order_item_scans ?? [])]
        .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))
        .map((s) => s.serial),
    }));

  const buffer = await renderPickSlipPdfBuffer({
    orderRef: order.order_ref,
    status: order.status,
    submittedAt: order.submitted_at,
    notes: order.notes,
    totalPaise: order.total_paise,
    tallyBillNo: order.tally_bill_no,
    retailerName: order.retailers?.name ?? "Unknown retailer",
    retailerArea: order.retailers?.area ?? null,
    retailerPhone: order.retailers?.phone ?? null,
    salesmanName: order.salesman?.full_name ?? "Unknown",
    showModel: order.brands?.show_model ?? false,
    items,
    printedAtIso: new Date().toISOString(),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      // inline → the phone's native PDF viewer opens it (share from there);
      // the filename is what a download/share saves it as.
      "Content-Disposition": `inline; filename="${order.order_ref}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
