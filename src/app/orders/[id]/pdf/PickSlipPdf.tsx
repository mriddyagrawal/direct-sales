import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatFullTimestamp, formatRupees } from "@/lib/format";

// react-pdf's built-in fonts (Helvetica/Courier) are WinAnsi-encoded — no ₹
// (U+20B9, rendered "¹") and no ⋆ (rendered "Æ"), both of which appear in
// real data. Until real fonts are registered (the planned follow-up), money
// renders as "Rs 15,000" (still formatRupees underneath — converted paise,
// en-IN grouping, never raw paise) and free text is mapped to WinAnsi-safe
// equivalents rather than garbled.
function pdfMoney(paise: number): string {
  return `Rs ${formatRupees(paise).replace(/^₹/, "")}`;
}

const GLYPH_MAP: Record<string, string> = {
  "⋆": "*",
  "★": "*",
  "・": " · ",
  "→": "->",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
};

function pdfText(text: string): string {
  // Collapse whitespace FIRST (so a newline in a note becomes a space, not a
  // "?"), then map known symbols and squash anything else outside printable
  // Latin-1 to "?" so the WinAnsi encoder never prints a random wrong glyph.
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^ -ÿ]/g, (c) => GLYPH_MAP[c] ?? "?");
}

// The A5 ORDER COPY as a real generated PDF — mirrors the on-screen sheet
// (PickSlip.tsx): header + ORDER COPY badge, meta, QTY·ITEM·RATE·AMOUNT table
// with the LG model line under show_model brands, total incl. GST, notes,
// signature lines, footer. Server-side only (rendered by the sibling route
// handler) — @react-pdf/renderer never enters a client bundle.
//
// Fonts: react-pdf built-ins — Helvetica for structure, Courier for the mono
// figures (refs, money, timestamps) — mirroring the app's structure/figures
// split without font-registration friction. (Registering Space Grotesk /
// JetBrains Mono is a follow-up, not v1.)

export interface PickSlipPdfItem {
  product_name: string;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  tally_name: string | null;
  serials: string[];
}

export interface PickSlipPdfProps {
  orderRef: string;
  status: string;
  submittedAt: string;
  notes: string;
  totalPaise: number;
  tallyBillNo: string | null;
  retailerName: string;
  retailerArea: string | null;
  retailerPhone: string | null;
  salesmanName: string;
  showModel: boolean;
  items: PickSlipPdfItem[];
  printedAtIso: string;
}

const INK = "#14181f";
const LOCKED = "#6b7580";
const HAIRLINE = "#d8dbdf";
const NAVY = "#1e3a8a"; // model line on show_model (LG) items

// Status under the ORDER COPY badge — the app's status language ("Billed",
// not the DB's 'processed') with the app's tone colours.
const STATUS_LABEL: Record<string, string> = {
  pending_approval: "PENDING APPROVAL",
  approved: "WAITING FOR SCAN",
  ready_to_bill: "READY TO BILL",
  billed: "BILLED",
  cancelled: "CANCELLED",
};

const STATUS_COLOR: Record<string, string> = {
  pending_approval: "#b45309", // amber
  approved: LOCKED,
  ready_to_bill: "#1d4ed8", // accent
  billed: "#15803d", // green
  cancelled: "#b91c1c", // red
};

const s = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 30,
    paddingHorizontal: 28,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  brand: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.2,
  },
  ref: {
    fontFamily: "Courier-Bold",
    fontSize: 16,
    marginTop: 4,
  },
  badgeCol: {
    alignItems: "flex-end",
    gap: 4,
  },
  badge: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: INK,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  status: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
  },
  metaBlock: {
    marginTop: 12,
    gap: 2,
  },
  metaLine: {
    fontSize: 8,
    color: INK,
  },
  metaMono: {
    fontFamily: "Courier",
    fontSize: 8,
  },
  linesRule: {
    marginTop: 12,
    paddingBottom: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: INK,
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 0.8,
    color: LOCKED,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    alignItems: "flex-start",
  },
  colQty: { width: 30, textAlign: "right" },
  colItem: { flex: 1, paddingRight: 6 },
  colRate: { width: 64, textAlign: "right" },
  colAmount: { width: 70, textAlign: "right" },
  qty: {
    fontFamily: "Courier-Bold",
    fontSize: 10,
  },
  itemName: {
    fontSize: 9,
  },
  // show_model (LG) items lead with the MODEL — navy, mono, the thing the
  // godown/accountant actually match against the box — with the friendly
  // display name beneath in muted grey (owner decision).
  itemModelPrimary: {
    fontFamily: "Courier-Bold",
    fontSize: 9,
    color: NAVY,
  },
  itemNameSecondary: {
    fontSize: 8,
    color: LOCKED,
    marginTop: 1.5,
  },
  // Serials nested under the line — mirrors the on-screen order page: an
  // italic "Serials" tag, then each serial stacked in muted mono.
  serialWrap: {
    marginTop: 3,
  },
  serialTag: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 7,
    color: LOCKED,
  },
  serialLine: {
    fontFamily: "Courier",
    fontSize: 8,
    color: LOCKED,
    marginTop: 0.5,
  },
  money: {
    fontFamily: "Courier",
    fontSize: 9,
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  totalLabel: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  totalMoney: {
    fontFamily: "Courier-Bold",
    fontSize: 10,
    textAlign: "right",
  },
  notesBox: {
    marginTop: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
    fontSize: 8,
  },
  signatures: {
    flexDirection: "row",
    gap: 24,
    marginTop: 34,
  },
  signatureLine: {
    flex: 1,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: INK,
    fontSize: 8,
    color: LOCKED,
  },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 28,
    right: 28,
    textAlign: "center",
    fontSize: 7,
    color: LOCKED,
  },
});

export function PickSlipPdf({
  orderRef,
  status,
  submittedAt,
  notes,
  totalPaise,
  tallyBillNo,
  retailerName,
  retailerArea,
  retailerPhone,
  salesmanName,
  showModel,
  items,
  printedAtIso,
}: PickSlipPdfProps) {
  return (
    <Document title={orderRef} author="Ganpati Enterprises">
      <Page size="A5" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.brand}>GANPATI ENTERPRISES</Text>
            {/* No separate brand line — the ref already carries it (ORD-LG-…). */}
            <Text style={s.ref}>{orderRef}</Text>
          </View>
          <View style={s.badgeCol}>
            <Text style={s.badge}>ORDER COPY</Text>
            <Text style={[s.status, { color: STATUS_COLOR[status] ?? LOCKED }]}>
              {STATUS_LABEL[status] ?? status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={s.metaBlock}>
          <Text style={s.metaLine}>
            Submitted: <Text style={s.metaMono}>{formatFullTimestamp(submittedAt)}</Text>
          </Text>
          <Text style={s.metaLine}>
            Retailer: {pdfText(retailerName)}
            {retailerArea ? `, ${pdfText(retailerArea)}` : ""}
            {retailerPhone ? "   Ph: " : ""}
            {retailerPhone ? <Text style={s.metaMono}>{retailerPhone}</Text> : null}
          </Text>
          <Text style={s.metaLine}>Salesman: {pdfText(salesmanName)}</Text>
          {/* Bill No only on a billed order (null → omit the line entirely). */}
          {tallyBillNo ? (
            <Text style={s.metaLine}>
              Bill No: <Text style={s.metaMono}>{pdfText(tallyBillNo)}</Text>
            </Text>
          ) : null}
        </View>

        <Text style={s.linesRule}>{items.length} {items.length === 1 ? "LINE" : "LINES"}</Text>

        {/* ITEM leads (owner decision) — the item is what the reader scans
            for first; qty/rate/amount follow as figures columns. */}
        <View style={s.tableHeader}>
          <Text style={[s.th, s.colItem]}>ITEM</Text>
          <Text style={[s.th, s.colQty]}>QTY</Text>
          <Text style={[s.th, s.colRate]}>RATE</Text>
          <Text style={[s.th, s.colAmount]}>AMOUNT</Text>
        </View>

        {items.map((item, i) => (
          <View key={i} style={s.row} wrap={false}>
            <View style={s.colItem}>
              {showModel && item.tally_name && item.tally_name !== item.product_name ? (
                <>
                  <Text style={s.itemModelPrimary}>{pdfText(item.tally_name)}</Text>
                  <Text style={s.itemNameSecondary}>{pdfText(item.product_name)}</Text>
                </>
              ) : (
                <Text style={s.itemName}>{pdfText(item.product_name)}</Text>
              )}
              {item.serials.length > 0 && (
                <View style={s.serialWrap}>
                  <Text style={s.serialTag}>Serials</Text>
                  {item.serials.map((serial, j) => (
                    <Text key={j} style={s.serialLine}>{pdfText(serial)}</Text>
                  ))}
                </View>
              )}
            </View>
            <Text style={[s.qty, s.colQty]}>{item.qty}</Text>
            <Text style={[s.money, s.colRate]}>{pdfMoney(item.unit_price_paise)}</Text>
            <Text style={[s.money, s.colAmount]}>{pdfMoney(item.line_total_paise)}</Text>
          </View>
        ))}

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Total (incl. GST)</Text>
          <Text style={[s.totalMoney, s.colAmount]}>{pdfMoney(totalPaise)}</Text>
        </View>

        {notes ? <Text style={s.notesBox}>Notes: {pdfText(notes)}</Text> : null}

        <View style={s.signatures}>
          <Text style={s.signatureLine}>Packed by</Text>
          <Text style={s.signatureLine}>Checked by</Text>
        </View>

        <Text style={s.footer} fixed>
          GANPATI ENTERPRISES · ORDER CAPTURE — Generated {formatFullTimestamp(printedAtIso)}
        </Text>
      </Page>
    </Document>
  );
}

// Keeps JSX out of the route handler (route.ts stays a plain .ts file).
export function renderPickSlipPdfBuffer(props: PickSlipPdfProps) {
  return renderToBuffer(<PickSlipPdf {...props} />);
}
