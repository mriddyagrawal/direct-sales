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

  // The claim, top right — the same figure the page states above its statement,
  // so the document opens by saying what it is about rather than making the
  // reader add up two pages to find out.
  idRow: { flexDirection: "row", alignItems: "flex-start" },
  idLeft: { flex: 1 },
  claimBox: { alignItems: "flex-end" },
  claimLabel: { fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 0.5, color: "#555" },
  claimValue: { fontFamily: "Courier-Bold", fontSize: 15, marginTop: 2 },

  // BALANCE DUE sits ON the table's grid: the label right-aligns across the
  // first four columns and the figure occupies the last two, so its right edge
  // lands exactly under the BALANCE column above it. Floating it loose was what
  // made it look unmoored from the table it concludes.
  due: { flexDirection: "row", alignItems: "baseline", marginTop: 9 },
  dueLabel: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 9.5, textAlign: "right", marginRight: 12 },
  dueValue: { width: "28%", fontFamily: "Courier-Bold", fontSize: 12, textAlign: "right" },

  // Colour marks the CONCLUSION only — see the note where these are applied.
  owed: { color: "#b91c1c" },
  clear: { color: "#15803d" },

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

  // Dr / Cr rather than a sign — this is a ledger document, and it is what
  // Tally itself prints. Cr takes the absolute value: "-Rs 45,000 Cr" would say
  // the opposite of what it means.
  const dueText =
    p.outstandingPaise < 0
      ? `${pdfMoney(-p.outstandingPaise)} Cr`
      : `${pdfMoney(p.outstandingPaise)}${p.outstandingPaise > 0 ? " Dr" : ""}`;
  // COLOUR MARKS THE CONCLUSION, NOT EVERY LINE, and only here and at the top.
  //
  // The DR and CR columns stay black on purpose. Direction already comes from
  // WHICH COLUMN a figure sits in, so colour would be decoration; 30 red rows
  // would drown the one figure that matters; and this document gets printed and
  // photocopied in black and white, where colour carries nothing at all. The
  // Dr/Cr words are what survive a mono printer, which is why they do the work.
  //
  // Red when the shop owes, green when it does not — the app's rule everywhere
  // (a credit balance is green because there is nothing to chase).
  const dueTone = p.outstandingPaise > 0 ? s.owed : s.clear;

  const totalDebit = p.entries.reduce((sum, e) => sum + e.debit_paise, 0) + Math.max(p.openingPaise, 0);
  const totalCredit = p.entries.reduce((sum, e) => sum + e.credit_paise, 0) + Math.max(-p.openingPaise, 0);

  const doc = (
    <Document title={`Statement of Account - ${pdfText(p.retailerName)}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>GANPATI ENTERPRISES</Text>
        <Text style={s.docTitle}>STATEMENT OF ACCOUNT</Text>
        <View style={s.rule} />

        <View style={s.idRow}>
          <View style={s.idLeft}>
            <Text style={s.shopName}>{pdfText(p.retailerName)}</Text>
            {meta && <Text style={s.shopMeta}>{pdfText(meta)}</Text>}
          </View>
          {/* Stated at the top and proved at the bottom — the same argument the
              screen makes, and the reason this figure appears twice. */}
          <View style={s.claimBox}>
            <Text style={s.claimLabel}>OUTSTANDING</Text>
            <Text style={[s.claimValue, dueTone]}>{dueText}</Text>
          </View>
        </View>
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
          {/* COLUMN STYLE FIRST, `th` LAST — react-pdf resolves a style array
              last-wins, so the old [s.th, s.cX] order let each column's own
              fontFamily override the header's. Five headers silently took
              Courier from their column; ENTRY, the only column that sets no
              font, kept Helvetica-Bold — which is exactly the odd one out the
              owner spotted. This way the column contributes width and
              alignment, and `th` contributes the type for all six. */}
          <Text style={[s.cDate, s.th]}>DATE</Text>
          <Text style={[s.cEntry, s.th]}>ENTRY</Text>
          <Text style={[s.cVoucher, s.th]}>VOUCHER</Text>
          <Text style={[s.cMoney, s.th]}>DR</Text>
          <Text style={[s.cMoney, s.th]}>CR</Text>
          <Text style={[s.cMoney, s.th]}>BALANCE</Text>
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
          <Text style={[s.dueValue, dueTone]}>{dueText}</Text>
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
