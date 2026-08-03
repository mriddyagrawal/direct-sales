import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatFullDate, formatFullTimestamp, formatShortDate } from "@/lib/format";
import { pdfMoney, pdfText } from "@/lib/pdf-encoding";
import type { LedgerEntryRow } from "@/lib/queries/ledger";

// The STATEMENT OF ACCOUNT as a real generated PDF — the document a salesman
// hands a shopkeeper in the shop, and the strongest collection tool on the
// ledger page. Server-side only (rendered by the sibling route handler), so
// @react-pdf/renderer never enters a client bundle.
//
// A4, not the pick slip's A5: this is a six-column table that has to stay
// legible after a phone photo of a printout.
//
// Fonts are react-pdf's built-ins — Helvetica for structure, Courier for
// figures — which is why money reads "Rs 15,064" and not "₹15,064". That is an
// ENCODING limit, documented in src/lib/pdf-encoding.ts, not a style choice.

export interface StatementPdfProps {
  retailerName: string;
  area: string | null;
  phone: string | null;
  entries: LedgerEntryRow[];
  // The shop's current outstanding, in paise. Null shops never reach here —
  // the route refuses to build a statement it cannot foot.
  outstandingPaise: number;
  // Everything before the first row in the document. ALWAYS printed, even at
  // zero: on screen a zero opening says nothing and is hidden, but a document
  // that must foot needs the line that says nothing was left out.
  openingPaise: number;
  balanceAsOf: string | null;
  printedAtIso: string;
}

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 34, fontFamily: "Helvetica", fontSize: 9 },

  brand: { fontFamily: "Helvetica-Bold", fontSize: 13, letterSpacing: 1.2 },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginTop: 2, letterSpacing: 0.6 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: "#14181f", marginTop: 8, marginBottom: 10 },

  shopName: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  shopMeta: { fontSize: 9, color: "#555", marginTop: 2 },
  period: { fontFamily: "Courier", fontSize: 9, marginTop: 6 },
  asOf: { fontFamily: "Courier", fontSize: 8.5, color: "#555", marginTop: 1 },

  thead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#14181f", paddingBottom: 3, marginTop: 12 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 0.5, color: "#555" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d8dbdf", paddingVertical: 4 },

  cDate: { width: "13%", fontFamily: "Courier", fontSize: 8.5 },
  cEntry: { width: "29%", fontSize: 9 },
  cVoucher: { width: "16%", fontFamily: "Courier", fontSize: 8.5, color: "#555" },
  cMoney: { width: "14%", fontFamily: "Courier", fontSize: 8.5, textAlign: "right" },

  openingRow: { color: "#555" },
  totalRow: { flexDirection: "row", borderTopWidth: 1.5, borderTopColor: "#14181f", paddingTop: 5, marginTop: 1 },
  totalLabel: { width: "58%", fontFamily: "Helvetica-Bold", fontSize: 9 },
  totalMoney: { width: "14%", fontFamily: "Courier-Bold", fontSize: 9, textAlign: "right" },

  due: { flexDirection: "row", justifyContent: "flex-end", marginTop: 12 },
  dueLabel: { fontFamily: "Helvetica-Bold", fontSize: 10, marginRight: 10 },
  dueValue: { fontFamily: "Courier-Bold", fontSize: 12 },

  empty: { fontSize: 9, color: "#555", paddingVertical: 10 },

  footer: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: "Courier",
    fontSize: 7.5,
    color: "#777",
  },
});

export async function renderStatementPdfBuffer(p: StatementPdfProps): Promise<Buffer> {
  const meta = [p.area, p.phone].filter(Boolean).join("  ·  ");

  // THE PERIOD IS CLAMPED TO REAL DATA — the span of rows actually in this
  // document, never the filter's nominal start. The screen may say "04 Feb"
  // while the earliest row held is 1 May; on screen that overstatement is
  // harmless, but a document handed to a shopkeeper must not claim months it
  // has no entries for. The opening balance accounts for everything before the
  // first row, so the statement is still complete.
  const first = p.entries[0]?.entry_date ?? null;
  const last = p.entries[p.entries.length - 1]?.entry_date ?? null;

  // The running balance the screen deliberately does not carry: on a phone it
  // was a second figure per row that nobody asked for, but here the reader is
  // reconciling line by line and there is room.
  let running = p.openingPaise;
  const rows = p.entries.map((e) => {
    running = running + e.debit_paise - e.credit_paise;
    return { ...e, balance: running };
  });

  const totalDebit = p.entries.reduce((sum, e) => sum + e.debit_paise, 0) + Math.max(p.openingPaise, 0);
  const totalCredit = p.entries.reduce((sum, e) => sum + e.credit_paise, 0) + Math.max(-p.openingPaise, 0);

  const doc = (
    <Document title={`Statement of Account - ${pdfText(p.retailerName)}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>GANPATI ENTERPRISES</Text>
        <Text style={s.docTitle}>STATEMENT OF ACCOUNT</Text>
        <View style={s.rule} />

        <Text style={s.shopName}>{pdfText(p.retailerName)}</Text>
        {meta && <Text style={s.shopMeta}>{pdfText(meta)}</Text>}
        <Text style={s.period}>
          {first && last ? `Period  ${formatFullDate(first)} to ${formatFullDate(last)}` : "Period  no entries"}
        </Text>
        {p.balanceAsOf && (
          <Text style={s.asOf}>As per our books as on {formatFullTimestamp(p.balanceAsOf)}</Text>
        )}

        {/* `fixed` repeats this on every page. Without it page 2 of a
            50-entry statement was six unlabelled columns of figures — the
            reader has to know which is DR and which is CR, on a document whose
            whole job is being checkable. */}
        <View style={s.thead} fixed>
          <Text style={[s.th, s.cDate]}>DATE</Text>
          <Text style={[s.th, s.cEntry]}>ENTRY</Text>
          <Text style={[s.th, s.cVoucher]}>VOUCHER</Text>
          <Text style={[s.th, s.cMoney]}>DR</Text>
          <Text style={[s.th, s.cMoney]}>CR</Text>
          <Text style={[s.th, s.cMoney]}>BALANCE</Text>
        </View>

        {/* Always printed, even at Rs 0 — see openingPaise. */}
        <View style={s.row}>
          <Text style={[s.cDate, s.openingRow]}>—</Text>
          <Text style={[s.cEntry, s.openingRow]}>Opening balance</Text>
          <Text style={[s.cVoucher, s.openingRow]}> </Text>
          <Text style={[s.cMoney, s.openingRow]}>
            {p.openingPaise > 0 ? pdfMoney(p.openingPaise) : "-"}
          </Text>
          <Text style={[s.cMoney, s.openingRow]}>
            {p.openingPaise < 0 ? pdfMoney(-p.openingPaise) : "-"}
          </Text>
          <Text style={[s.cMoney, s.openingRow]}>{pdfMoney(p.openingPaise)}</Text>
        </View>

        {rows.length === 0 ? (
          <Text style={s.empty}>No entries in this period.</Text>
        ) : (
          rows.map((e) => (
            <View key={e.id} style={s.row} wrap={false}>
              <Text style={s.cDate}>{formatShortDate(e.entry_date)}</Text>
              {/* Tally's own voucher type, verbatim — this document exists to be
                  held beside Tally and agree. */}
              <Text style={s.cEntry}>{pdfText(e.voucher_type)}</Text>
              <Text style={s.cVoucher}>{e.voucher_no ? pdfText(e.voucher_no) : "-"}</Text>
              <Text style={s.cMoney}>{e.debit_paise > 0 ? pdfMoney(e.debit_paise) : "-"}</Text>
              <Text style={s.cMoney}>{e.credit_paise > 0 ? pdfMoney(e.credit_paise) : "-"}</Text>
              <Text style={s.cMoney}>{pdfMoney(e.balance)}</Text>
            </View>
          ))
        )}

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>TOTAL</Text>
          <Text style={s.totalMoney}>{pdfMoney(totalDebit)}</Text>
          <Text style={s.totalMoney}>{pdfMoney(totalCredit)}</Text>
          <Text style={s.totalMoney}> </Text>
        </View>

        <View style={s.due}>
          <Text style={s.dueLabel}>BALANCE DUE</Text>
          {/* Dr / Cr rather than a sign: this is a ledger document, and it is
              the convention Tally itself prints. */}
          <Text style={s.dueValue}>
            {p.outstandingPaise < 0
              ? `${pdfMoney(-p.outstandingPaise)} Cr`
              : `${pdfMoney(p.outstandingPaise)}${p.outstandingPaise > 0 ? " Dr" : ""}`}
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text>GANPATI ENTERPRISES — Generated {formatFullTimestamp(p.printedAtIso)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
