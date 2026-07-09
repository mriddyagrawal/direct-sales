import { formatFullTimestamp, formatRupees } from "@/lib/format";

// Shared builder for the WhatsApp-friendly order text used by the mobile
// Share button (salesman order detail + pick slip). Plain text, NO url — the
// order pages are auth-gated, so a link is useless to a non-user recipient;
// we share the content itself. `withPrices` mirrors the pick slip's toggle:
// off = a pick list (qty + item, "PICK SLIP"); on = a priced order copy.
export interface OrderShareItem {
  product_name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
}

export interface OrderShareInput {
  orderRef: string;
  brandName: string | null;
  submittedAt: string;
  retailerName: string;
  retailerArea: string | null;
  retailerPhone: string | null;
  salesmanName: string | null;
  items: OrderShareItem[];
  totalPaise: number;
  notes: string;
  withPrices: boolean;
}

export function buildOrderShareText(o: OrderShareInput): string {
  const lines: string[] = ["GANPATI ENTERPRISES"];
  lines.push(`${o.orderRef}${o.brandName ? ` · ${o.brandName}` : ""} — ${o.withPrices ? "ORDER COPY" : "PICK SLIP"}`);
  lines.push(`Submitted: ${formatFullTimestamp(o.submittedAt)}`);
  lines.push(
    `Retailer: ${o.retailerName}${o.retailerArea ? `, ${o.retailerArea}` : ""}${
      o.retailerPhone ? ` · Ph ${o.retailerPhone}` : ""
    }`,
  );
  if (o.salesmanName) lines.push(`Salesman: ${o.salesmanName}`);

  lines.push("");
  lines.push(`${o.items.length} ${o.items.length === 1 ? "LINE" : "LINES"}`);
  for (const it of o.items) {
    const base = `${it.qty} × ${it.product_name}`;
    lines.push(
      o.withPrices ? `${base}  @ ${formatRupees(it.unit_price_paise)} = ${formatRupees(it.line_total_paise)}` : base,
    );
  }
  if (o.withPrices) lines.push(`Total (incl. GST): ${formatRupees(o.totalPaise)}`);

  if (o.notes) {
    lines.push("");
    lines.push(`Notes: ${o.notes}`);
  }
  return lines.join("\n");
}
