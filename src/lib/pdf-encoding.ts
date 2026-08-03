import { formatRupees } from "@/lib/format";

// WinAnsi survival kit for @react-pdf/renderer, shared by every PDF this app
// generates. Lifted out of PickSlipPdf.tsx when the statement became the second
// document (owner 2026-08-04) — two PDFs with two private copies of the same
// workaround is exactly how they drift apart, which is the lesson readBalance
// already taught this codebase.
//
// react-pdf's built-in fonts (Helvetica / Courier) are WinAnsi-encoded, so
// they have no ₹ (U+20B9 prints as "¹") and no ⋆ (prints as "Æ") — both of
// which appear in real data here. This is an ENCODING limit, not a style
// choice: printing ₹ does not look worse, it prints the wrong character.
//
// The fix is registering real fonts, which is a known follow-up: it means
// committing font binaries to the repo, re-checking every column of both
// documents against new metrics, and proving the files resolve at runtime on
// Vercel — where a failure breaks PDF generation outright rather than
// degrading. Until then, these two functions are the workaround.

// "Rs 15,000" — still formatRupees underneath, so paise are converted and
// grouped en-IN, never printed raw.
//
// ⚠️ The strip is UNANCHORED, and that is the whole point. It used to be
// /^₹/, which works only while the ₹ is the first character — and on a NEGATIVE
// amount formatRupees returns "-₹15,702", sign first. So the ₹ survived, and
// WinAnsi printed it as the superscript "¹": a live statement showed
// "Rs -¹15,702" on every row where a shop went into credit (owner caught it in
// the first generated PDF, 2026-08-04). The pick slip shared the same bug the
// moment it was handed a negative.
export function pdfMoney(paise: number): string {
  return `Rs ${pdfAmount(paise)}`;
}

// The bare figure — grouped en-IN, no currency mark at all: "15,702".
//
// For a COLUMN of money, where repeating "Rs" on every row is noise and the
// unit is established once by the document's own standalone figures. The
// ₹-strip lives here rather than being repeated, so the anchoring bug above
// cannot come back in a second place.
export function pdfAmount(paise: number): string {
  return formatRupees(paise).replace("₹", "");
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

export function pdfText(text: string): string {
  // Collapse whitespace FIRST (so a newline in a note becomes a space, not a
  // "?"), then map known symbols and squash anything else outside printable
  // Latin-1 to "?" so the WinAnsi encoder never prints a random wrong glyph.
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^ -ÿ]/g, (c) => GLYPH_MAP[c] ?? "?");
}
