"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PickRetailer, type SelectedRetailer } from "@/app/new-order/PickRetailer";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { parsePricePaise } from "@/lib/price";
import { formatRupees } from "@/lib/format";
import {
  depositNetPaise,
  parseDiscountPaise,
  methodNoteRule,
  findDuplicateReceipt,
  type ReceiptRefRow,
} from "@/lib/deposit-fields";
import { createDeposit, updateDeposit, voidDeposit, type DepositMethod } from "@/lib/deposit-rpcs";
import { createClient } from "@/lib/supabase/client";
import type { RetailerOption } from "@/app/new-order/page";
import styles from "./DepositFlow.module.css";

export interface EditDepositData {
  id: string;
  retailerId: string;
  retailerName: string;
  retailerArea: string | null;
  amountPaise: number;
  discountPaise: number;
  previousOutstandingPaise: number | null;
  receiptRef: string;
  // The DEPOSIT's salesman (≠ the viewer when an admin edits) — the
  // duplicate-receipt warning must check against the book that wrote it.
  salesmanId: string;
  method: string;
  note: string;
}

interface DepositFlowProps {
  retailers: RetailerOption[];
  recentRetailerIds: string[];
  salesmanId: string;
  editDeposit: EditDepositData | null;
  // Role-aware landing after save/delete (salesman → /deposits, staff →
  // /dashboard/deposits) — mirrors new-order's detailBase.
  returnTo: string;
}

const METHODS: { value: DepositMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "online", label: "Online" },
];

// New/Edit deposit — a deliberately tiny flow (owner 2026-07-19): pick the
// shop, type the amount, tap the method, save. Reuses PickRetailer wholesale.
// Edit mode prefills and adds VOID (reason required — nothing is ever hard-
// deleted; the row stays struck + out of totals). The 30-minute window +
// admin-anytime gates live in the RPCs — a locked row never reaches here
// (the page redirects), and the server refuses regardless.
export function DepositFlow({ retailers, recentRetailerIds, salesmanId, editDeposit, returnTo }: DepositFlowProps) {
  const router = useRouter();
  const isEdit = editDeposit !== null;

  const [step, setStep] = useState<"retailer" | "form">(isEdit ? "form" : "retailer");
  const [retailer, setRetailer] = useState<SelectedRetailer | null>(
    isEdit
      ? { id: editDeposit!.retailerId, name: editDeposit!.retailerName, area: editDeposit!.retailerArea }
      : null,
  );
  const [amountText, setAmountText] = useState(isEdit ? String(editDeposit!.amountPaise / 100) : "");
  const [discountText, setDiscountText] = useState(
    isEdit && editDeposit!.discountPaise > 0 ? String(editDeposit!.discountPaise / 100) : "",
  );
  const [receiptRef, setReceiptRef] = useState(isEdit ? editDeposit!.receiptRef : "");
  const [method, setMethod] = useState<DepositMethod | null>(
    isEdit ? (editDeposit!.method as DepositMethod) : null,
  );
  const [note, setNote] = useState(isEdit ? editDeposit!.note : "");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The same-salesman duplicate-receipt warning (owner 2026-08-31: warn,
  // never block) — a QUIET pop-up, not the godown's PAKKA (owner 2026-09-01:
  // same mechanism, none of the volume). Few words: the salesmen read numbers
  // better than sentences. "Save anyway" proceeds; "Change no." backs out.
  const [dupSheet, setDupSheet] = useState<{ ref: string; depRef: string; amountPaise: number; when: string } | null>(
    null,
  );

  function handleSelectRetailer(r: SelectedRetailer) {
    setRetailer(r);
    setStep("form");
  }

  const noteRule = methodNoteRule(method);

  // Live derivation for the preview line: net = amount − discount, shown only
  // once both parse and a discount is actually in play.
  const parsedAmount = parsePricePaise(amountText);
  const amountPaiseOrNull = parsedAmount.ok ? parsedAmount.paise : null;
  const parsedDiscount = parseDiscountPaise(discountText, amountPaiseOrNull);
  const netPreview =
    parsedAmount.ok && parsedAmount.paise != null && parsedDiscount.ok && parsedDiscount.paise != null && parsedDiscount.paise > 0
      ? depositNetPaise(parsedAmount.paise, parsedDiscount.paise)
      : null;

  // The outstanding is AUTO-PULLED server-side from the retailer's Tally-
  // synced figure (owner 2026-09-01) — no field here, nothing to preview.

  async function handleSave(skipDupCheck = false) {
    const parsed = parsePricePaise(amountText);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.paise == null) {
      setError("Enter the amount.");
      return;
    }
    const discount = parseDiscountPaise(discountText, parsed.paise);
    if (!discount.ok) {
      setError(discount.error);
      return;
    }
    const ref = receiptRef.trim();
    if (ref === "") {
      setError("Enter the receipt number from your receipt book.");
      return;
    }
    if (!method) {
      setError("Pick how it was paid — Cash, Cheque or Online.");
      return;
    }
    const cleanNote = note.trim();
    if (noteRule.required && cleanNote === "") {
      setError(noteRule.missingError);
      return;
    }
    if (!retailer) return; // unreachable — the form step requires a pick
    setSaving(true);
    setError(null);

    // Duplicate check against THIS book's rows — the deposit's salesman when
    // editing (an admin correcting is still checking that salesman's book),
    // the caller when creating. Advisory only: on failure to fetch we save
    // rather than trap the salesman behind a broken warning.
    if (!skipDupCheck) {
      try {
        const supabase = createClient();
        const bookOwner = isEdit ? editDeposit!.salesmanId : salesmanId;
        const { data } = await supabase
          .from("deposits")
          .select("id, deposit_ref, receipt_ref, amount_paise, created_at, voided_at")
          .eq("salesman_id", bookOwner)
          .not("receipt_ref", "is", null)
          .order("created_at", { ascending: false })
          .limit(500);
        const dup = findDuplicateReceipt((data ?? []) as ReceiptRefRow[], ref, isEdit ? editDeposit!.id : null);
        if (dup) {
          const when = new Date(dup.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
          setDupSheet({ ref, depRef: dup.deposit_ref, amountPaise: dup.amount_paise, when });
          setSaving(false);
          return;
        }
      } catch {
        // fall through — the warning is best-effort, never a gate
      }
    }

    try {
      if (isEdit) {
        // Pass the stored value through UNCHANGED — the column is legacy now
        // (auto-pull era) but nulling it on edit would spray "outstanding
        // ₹X → —" noise into old rows' trails.
        await updateDeposit(
          editDeposit!.id, retailer.id, parsed.paise, method, ref, discount.paise ?? 0,
          editDeposit!.previousOutstandingPaise, cleanNote || undefined,
        );
      } else {
        await createDeposit(
          retailer.id, parsed.paise, method, ref, discount.paise ?? 0, null, cleanNote || undefined,
        );
      }
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the deposit.");
      setSaving(false);
    }
  }

  async function handleVoid() {
    if (!voidReason.trim()) {
      setError("A reason is required to void a deposit.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await voidDeposit(editDeposit!.id, voidReason.trim());
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not void the deposit.");
      setSaving(false);
    }
  }

  if (step === "retailer") {
    return (
      <PickRetailer
        retailers={retailers}
        recentRetailerIds={recentRetailerIds}
        salesmanId={salesmanId}
        onSelect={handleSelectRetailer}
        onBack={() => (isEdit ? setStep("form") : router.push(returnTo))}
      />
    );
  }

  return (
    <div className={styles.page}>
      <FlowHeader
        title={isEdit ? "Edit deposit" : "New deposit"}
        subtitle={retailer?.name}
        onBack={() => router.push(returnTo)}
      />
      <div className={styles.content}>
        <div className={styles.retailerRow}>
          <div>
            <p className={styles.retailerName}>{retailer?.name}</p>
            {retailer?.area && <p className={styles.retailerArea}>{retailer.area}</p>}
          </div>
          <button type="button" className={styles.changeLink} onClick={() => setStep("retailer")}>
            Change
          </button>
        </div>

        <label className={styles.fieldLabel} htmlFor="dep-receipt">
          RECEIPT NO.
        </label>
        <input
          id="dep-receipt"
          className={styles.noteInput}
          value={receiptRef}
          maxLength={40}
          placeholder="number from your receipt book"
          autoFocus={!isEdit}
          onChange={(e) => setReceiptRef(e.target.value)}
        />

        {/* "GROSS" in the salesman's face (owner 2026-09-01): this is the
            full figure off the paper receipt BEFORE discount — the amount
            the outstanding drops by. UI wording only; DB names unchanged. */}
        <label className={styles.fieldLabel}>GROSS AMOUNT</label>
        <label className={styles.amountField}>
          <span className={styles.amountPrefix}>₹</span>
          <input
            className={styles.amountInput}
            inputMode="decimal"
            value={amountText}
            placeholder="0"
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>

        <label className={styles.fieldLabel}>DISCOUNT · OPTIONAL</label>
        <label className={`${styles.amountField} ${styles.discountField}`}>
          <span className={styles.amountPrefix}>₹</span>
          <input
            className={styles.amountInput}
            inputMode="decimal"
            value={discountText}
            placeholder="0"
            onChange={(e) => setDiscountText(e.target.value)}
          />
        </label>

        {/* The owner's model made visible as it's typed: amount is the GROSS
            knocked off the balance, the net is derived — the salesman sees
            the money that should be in his hand before saving. */}
        {netPreview !== null && (
          <p className={styles.netLine}>
            Receiving <strong>{formatRupees(netPreview)}</strong>{" "}
            <s className={styles.netGross}>{formatRupees(parsedAmount.ok ? (parsedAmount.paise ?? 0) : 0)}</s> −{" "}
            {formatRupees(parsedDiscount.ok ? (parsedDiscount.paise ?? 0) : 0)} discount
          </p>
        )}

        <label className={styles.fieldLabel}>HOW WAS IT PAID?</label>
        <div className={styles.methodSeg} role="group" aria-label="Method">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`${styles.methodBtn} ${method === m.value ? styles.methodBtnActive : ""}`}
              onClick={() => setMethod(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* The note's identity follows the method (deposit-fields.ts): cheque
            no. / UPI ref are REQUIRED, cash keeps a free optional note. */}
        <label className={styles.fieldLabel} htmlFor="dep-note">
          {noteRule.label}
        </label>
        <input
          id="dep-note"
          className={styles.noteInput}
          value={note}
          maxLength={200}
          placeholder={noteRule.placeholder}
          onChange={(e) => setNote(e.target.value)}
        />

        {error && <p className={styles.error}>{error}</p>}

        <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
          {isEdit ? "Save changes" : "Save deposit"}
        </Button>
        {isEdit && (
          <Button variant="destructive" onClick={() => setConfirmVoid(true)} disabled={saving}>
            Void deposit
          </Button>
        )}
      </div>

      {dupSheet && (
        <BottomSheet onClose={() => setDupSheet(null)}>
          <p className={styles.confirmTitle}>Receipt {dupSheet.ref} used before</p>
          <p className={styles.confirmBody}>
            {dupSheet.depRef} · {formatRupees(dupSheet.amountPaise)} · {dupSheet.when}
          </p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" onClick={() => setDupSheet(null)}>
              Change no.
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDupSheet(null);
                void handleSave(true);
              }}
              loading={saving}
            >
              Save anyway
            </Button>
          </div>
        </BottomSheet>
      )}

      {confirmVoid && (
        <BottomSheet onClose={() => setConfirmVoid(false)}>
          <p className={styles.confirmTitle}>Void this deposit?</p>
          <p className={styles.confirmBody}>
            {retailer?.name} · the record stays in the ledger, struck out and excluded from totals.
          </p>
          <label className={styles.fieldLabel}>REASON (required)</label>
          <textarea
            className={styles.reasonInput}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="e.g. entered the wrong shop"
          />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.confirmActions}>
            <Button variant="secondary" onClick={() => setConfirmVoid(false)}>
              Keep it
            </Button>
            <Button variant="destructive-filled" onClick={handleVoid} loading={saving}>
              Void deposit
            </Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
