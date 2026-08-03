import { istDateKey } from "@/lib/format";

// The filename for a downloaded/shared statement: "Statement - <shop> - <date>.pdf".
//
// The shop name leads after the document type, because this file is most often
// sent straight into WhatsApp, where Android drops the share text and the
// FILENAME is the only field that reliably surfaces — the same reason the pick
// slip's helper exists. The date follows so a shopkeeper who receives one every
// month can tell them apart at a glance, and it is the IST calendar day, since
// that is the day the office and the shop both mean.
//
// Strips only filesystem-reserved characters and keeps the shop name short.
export function statementFileName(retailerName: string, now: Date = new Date()): string {
  const safe = retailerName
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
  const day = istDateKey(now);
  return safe ? `Statement - ${safe} - ${day}.pdf` : `Statement - ${day}.pdf`;
}
