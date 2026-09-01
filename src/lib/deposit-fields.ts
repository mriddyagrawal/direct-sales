import { parsePricePaise, type PriceParse } from "@/lib/price";

// Deposit field rules (owner 2026-08-31) — the receipt/discount extension.
//
// The model: AMOUNT is the GROSS figure being knocked off the retailer's
// balance (₹10,000); DISCOUNT is the concession (₹500); the money that
// physically changed hands is the NET (₹9,500) and is ALWAYS DERIVED, never
// typed — one less field to fat-finger, and the arithmetic cannot disagree
// with itself. The office books two Tally lines from one row (receipt 9,500 +
// discount 500), which is why every display keeps the figures separate:
// net prominent, gross struck through beside it, never a merged number.
//
// Existing rows predate the discount field; discount_paise defaults to 0
// there, and gross = net — their meaning is unchanged.

export function depositNetPaise(amountPaise: number, discountPaise: number): number {
  return amountPaise - discountPaise;
}

// Parse the DISCOUNT input. Deliberately built ON TOP of parsePricePaise so
// digit/decimal rules live in exactly one place (the pdf-encoding lesson:
// a second copy of a parser is where the rules diverge) — but discount
// differs from a price in two ways this wrapper owns:
//   · blank and zero are both fine (no discount), where a price must be > 0;
//   · it is bounded ABOVE by the amount — a discount equal to the whole
//     amount is a write-off wearing a costume, not a deposit (owner-confirmed:
//     strictly less than).
// `amountPaise` may be null when the amount itself hasn't parsed yet — then
// only the discount's own shape is checked and the bound waits for the amount.
export function parseDiscountPaise(input: string, amountPaise: number | null): PriceParse {
  const t = input.trim();
  if (t === "") return { ok: true, paise: 0 };
  if (/^0+(\.0+)?$/.test(t)) return { ok: true, paise: 0 };
  const parsed = parsePricePaise(t);
  if (!parsed.ok) return { ok: false, error: parsed.error.replace("Price", "Discount") };
  const paise = parsed.paise ?? 0;
  if (amountPaise !== null && paise >= amountPaise) {
    return { ok: false, error: "Discount must be less than the amount." };
  }
  return { ok: true, paise };
}

// The note field's identity follows the METHOD (owner 2026-08-31): a cheque
// deposit must carry its cheque number, an online one its UPI/transaction
// ref, and cash may carry a free note or nothing. Replaces the old "#"-seed
// nudge — a required, named field beats a hint character.
export interface NoteRule {
  label: string;
  placeholder: string;
  required: boolean;
  missingError: string;
}

export function methodNoteRule(method: string | null): NoteRule {
  switch (method) {
    case "cheque":
      return {
        label: "CHEQUE NO.",
        placeholder: "number on the cheque",
        required: true,
        missingError: "Enter the cheque number.",
      };
    case "online":
      return {
        label: "UPI REFERENCE",
        placeholder: "UPI ref / UTR",
        required: true,
        missingError: "Enter the UPI reference.",
      };
    case "cash":
      return { label: "NOTE · OPTIONAL", placeholder: "anything worth noting", required: false, missingError: "" };
    default:
      // No method picked yet — the field renders unlabeled-optional; save is
      // blocked earlier by the method requirement itself.
      return { label: "NOTE · OPTIONAL", placeholder: "", required: false, missingError: "" };
  }
}

// Receipt-ref comparison key, for the duplicate WARNING only (never a block,
// and never stored): paper receipt books restart, get replaced, and get
// transcribed with stray spaces or case drift — "a-123" and "A-123" are the
// same page of the same book. The stored value stays exactly as typed.
export function receiptRefKey(ref: string): string {
  return ref.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface ReceiptRefRow {
  id: string;
  deposit_ref: string;
  receipt_ref: string | null;
  amount_paise: number;
  created_at: string;
  voided_at: string | null;
}

// The same-salesman duplicate check (owner 2026-08-31: warn, don't block —
// cross-salesman duplicates are EXPECTED, each carries his own book, so the
// caller must already have scoped `rows` to one salesman's deposits).
// Voided rows don't count — their receipt number is legitimately reusable
// after a botched entry. Editing a row must not collide with itself.
export function findDuplicateReceipt(
  rows: ReceiptRefRow[],
  ref: string,
  excludeId: string | null,
): ReceiptRefRow | null {
  const key = receiptRefKey(ref);
  if (key === "") return null;
  for (const row of rows) {
    if (row.id === excludeId || row.voided_at !== null || row.receipt_ref === null) continue;
    if (receiptRefKey(row.receipt_ref) === key) return row;
  }
  return null;
}

// ---- The edit trail (owner 2026-09-01) ------------------------------------
// deposit_events 'updated' rows carry {before, after} jsonb. This turns one
// into display-ready change lines for the dashboard's expandable trail.
// Pure and defensive: events from the pre-receipt era lack receipt_ref /
// discount_paise keys entirely — a key absent on BOTH sides is no change.

export interface DepositEditChange {
  label: string;
  from: string;
  to: string;
}

interface EventSnapshot {
  retailer_id?: string | null;
  amount_paise?: number | null;
  discount_paise?: number | null;
  receipt_ref?: string | null;
  method?: string | null;
  note?: string | null;
}

const METHOD_LABELS: Record<string, string> = { cash: "Cash", cheque: "Cheque", online: "Online" };

function paiseLabel(v: number | null | undefined): string {
  if (v == null) return "—";
  return "₹" + new Intl.NumberFormat("en-IN").format(v / 100);
}

export function describeDepositEdit(before: EventSnapshot, after: EventSnapshot): DepositEditChange[] {
  const changes: DepositEditChange[] = [];
  const changed = (k: keyof EventSnapshot) => {
    const b = before[k] ?? null;
    const a = after[k] ?? null;
    return b !== a;
  };
  if (changed("retailer_id")) {
    // ids mean nothing to a reader; the fact of the change is the signal.
    changes.push({ label: "shop", from: "changed", to: "" });
  }
  if (changed("amount_paise")) {
    changes.push({ label: "amount", from: paiseLabel(before.amount_paise), to: paiseLabel(after.amount_paise) });
  }
  if (changed("discount_paise")) {
    changes.push({ label: "discount", from: paiseLabel(before.discount_paise ?? 0), to: paiseLabel(after.discount_paise ?? 0) });
  }
  if (changed("receipt_ref")) {
    changes.push({ label: "receipt", from: before.receipt_ref ?? "—", to: after.receipt_ref ?? "—" });
  }
  if (changed("method")) {
    changes.push({
      label: "method",
      from: METHOD_LABELS[before.method ?? ""] ?? before.method ?? "—",
      to: METHOD_LABELS[after.method ?? ""] ?? after.method ?? "—",
    });
  }
  if (changed("note")) {
    changes.push({ label: "note", from: before.note ?? "—", to: after.note ?? "—" });
  }
  return changes;
}
