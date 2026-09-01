import { describe, it, expect } from "vitest";
import {
  describeDepositEdit,
  depositNetPaise,
  parseDiscountPaise,
  methodNoteRule,
  receiptRefKey,
  findDuplicateReceipt,
  type ReceiptRefRow,
} from "@/lib/deposit-fields";

// The owner's worked example (2026-08-31): retailer owes 10,000, hands over
// 9,500, gets 500 let go. Form: amount 10,000 · discount 500. Display: 9,500
// prominent, 10,000 struck. These tests pin that arithmetic and the field
// rules around it.

describe("depositNetPaise", () => {
  it("derives the owner's worked example", () => {
    expect(depositNetPaise(1000000, 50000)).toBe(950000);
  });
  it("zero discount: net === gross (every pre-existing row)", () => {
    expect(depositNetPaise(1000000, 0)).toBe(1000000);
  });
  it("stays in integer paise — no float drift", () => {
    expect(depositNetPaise(55750, 25)).toBe(55725);
  });
});

describe("parseDiscountPaise", () => {
  it("blank means no discount, not an error", () => {
    expect(parseDiscountPaise("", 1000000)).toEqual({ ok: true, paise: 0 });
    expect(parseDiscountPaise("   ", 1000000)).toEqual({ ok: true, paise: 0 });
  });
  it("explicit zero is fine too (unlike a price)", () => {
    expect(parseDiscountPaise("0", 1000000)).toEqual({ ok: true, paise: 0 });
    expect(parseDiscountPaise("0.00", 1000000)).toEqual({ ok: true, paise: 0 });
  });
  it("parses rupees to paise like the price parser", () => {
    expect(parseDiscountPaise("500", 1000000)).toEqual({ ok: true, paise: 50000 });
    expect(parseDiscountPaise("500.5", 1000000)).toEqual({ ok: true, paise: 50050 });
  });
  it("rejects what the price parser rejects, with Discount wording", () => {
    const nonNumeric = parseDiscountPaise("abc", 1000000);
    expect(nonNumeric.ok).toBe(false);
    if (!nonNumeric.ok) expect(nonNumeric.error).toBe("Discount must be a number.");
    const negative = parseDiscountPaise("-5", 1000000);
    expect(negative.ok).toBe(false);
    const threeDecimals = parseDiscountPaise("1.005", 1000000);
    expect(threeDecimals.ok).toBe(false);
    if (!threeDecimals.ok) expect(threeDecimals.error).toContain("2 decimal places");
  });
  it("discount equal to the amount is refused — that's a write-off, not a deposit", () => {
    const equal = parseDiscountPaise("10000", 1000000);
    expect(equal.ok).toBe(false);
    if (!equal.ok) expect(equal.error).toBe("Discount must be less than the amount.");
  });
  it("discount above the amount is refused", () => {
    expect(parseDiscountPaise("10001", 1000000).ok).toBe(false);
  });
  it("one paisa under the amount is the maximum allowed", () => {
    expect(parseDiscountPaise("9999.99", 1000000)).toEqual({ ok: true, paise: 999999 });
  });
  it("null amount (not yet parsed) checks shape only, bound waits", () => {
    expect(parseDiscountPaise("999999", null)).toEqual({ ok: true, paise: 99999900 });
  });
});

describe("methodNoteRule", () => {
  it("cheque requires the cheque number", () => {
    const rule = methodNoteRule("cheque");
    expect(rule.required).toBe(true);
    expect(rule.label).toBe("CHEQUE NO.");
    expect(rule.missingError).toBe("Enter the cheque number.");
  });
  it("online requires the UPI reference", () => {
    const rule = methodNoteRule("online");
    expect(rule.required).toBe(true);
    expect(rule.label).toBe("UPI REFERENCE");
  });
  it("cash is optional", () => {
    expect(methodNoteRule("cash").required).toBe(false);
  });
  it("no method yet: optional, blocked elsewhere by the method requirement", () => {
    expect(methodNoteRule(null).required).toBe(false);
  });
});

describe("receiptRefKey", () => {
  it("folds case, trims, collapses internal whitespace", () => {
    expect(receiptRefKey("  A-123 ")).toBe("a-123");
    expect(receiptRefKey("a - 123")).toBe("a - 123");
    expect(receiptRefKey("A  -  123")).toBe("a - 123");
  });
});

describe("findDuplicateReceipt", () => {
  const rows: ReceiptRefRow[] = [
    { id: "1", deposit_ref: "DEP-1", receipt_ref: "A-123", amount_paise: 950000, created_at: "2026-08-30T10:00:00Z", voided_at: null },
    { id: "2", deposit_ref: "DEP-2", receipt_ref: "A-124", amount_paise: 10000, created_at: "2026-08-30T11:00:00Z", voided_at: "2026-08-30T12:00:00Z" },
    { id: "3", deposit_ref: "DEP-3", receipt_ref: null, amount_paise: 5000, created_at: "2026-08-30T12:00:00Z", voided_at: null },
  ];

  it("finds a case-insensitive match", () => {
    expect(findDuplicateReceipt(rows, "a-123", null)?.deposit_ref).toBe("DEP-1");
  });
  it("a VOIDED row's number is reusable — no warning", () => {
    expect(findDuplicateReceipt(rows, "A-124", null)).toBeNull();
  });
  it("legacy rows without a receipt ref never match", () => {
    expect(findDuplicateReceipt(rows, "", null)).toBeNull();
  });
  it("editing a row never collides with itself", () => {
    expect(findDuplicateReceipt(rows, "A-123", "1")).toBeNull();
  });
  it("a fresh number passes silently", () => {
    expect(findDuplicateReceipt(rows, "B-1", null)).toBeNull();
  });
});


describe("describeDepositEdit", () => {
  it("the owner's example: amount corrected", () => {
    expect(describeDepositEdit({ amount_paise: 1000000 }, { amount_paise: 950000 })).toEqual([
      { label: "amount", from: "₹10,000", to: "₹9,500" },
    ]);
  });
  it("en-IN grouping in the labels", () => {
    expect(describeDepositEdit({ amount_paise: 16782340000 }, { amount_paise: 100 })[0]).toEqual({
      label: "amount",
      from: "₹16,78,23,400",
      to: "₹1",
    });
  });
  it("several fields at once, stable order", () => {
    const out = describeDepositEdit(
      { amount_paise: 1000000, discount_paise: 0, receipt_ref: "12", method: "cash", note: null },
      { amount_paise: 1000000, discount_paise: 50000, receipt_ref: "14", method: "cheque", note: "123456" },
    );
    expect(out.map((c) => c.label)).toEqual(["discount", "receipt", "method", "note"]);
    expect(out[0]).toEqual({ label: "discount", from: "₹0", to: "₹500" });
    expect(out[2]).toEqual({ label: "method", from: "Cash", to: "Cheque" });
  });
  it("retailer change shows the fact, not the ids", () => {
    expect(describeDepositEdit({ retailer_id: "a" }, { retailer_id: "b" })).toEqual([
      { label: "shop", from: "changed", to: "" },
    ]);
  });
  it("pre-receipt-era events (keys absent on both sides) report no change", () => {
    expect(
      describeDepositEdit({ amount_paise: 5000, method: "cash" }, { amount_paise: 5000, method: "cash" }),
    ).toEqual([]);
  });
  it("a key appearing on one side only IS a change", () => {
    expect(describeDepositEdit({}, { receipt_ref: "A-1" })).toEqual([{ label: "receipt", from: "—", to: "A-1" }]);
  });
});
