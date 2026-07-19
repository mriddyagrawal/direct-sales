"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PickRetailer, type SelectedRetailer } from "@/app/new-order/PickRetailer";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { parsePricePaise } from "@/lib/price";
import { createDeposit, updateDeposit, voidDeposit, type DepositMethod } from "@/lib/deposit-rpcs";
import type { RetailerOption } from "@/app/new-order/page";
import styles from "./DepositFlow.module.css";

export interface EditDepositData {
  id: string;
  retailerId: string;
  retailerName: string;
  retailerArea: string | null;
  amountPaise: number;
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
// deleted; the row stays struck + out of totals). The 1-hour window +
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
  const [method, setMethod] = useState<DepositMethod | null>(
    isEdit ? (editDeposit!.method as DepositMethod) : null,
  );
  const [note, setNote] = useState(isEdit ? editDeposit!.note : "");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSelectRetailer(r: SelectedRetailer) {
    setRetailer(r);
    setStep("form");
  }

  // Picking Online (UPI) seeds the note with "#" as a nudge to paste the UPI
  // ref — plain state, so it's freely backspaceable. Switching away removes
  // the seed only if it's still exactly the untouched "#".
  function pickMethod(m: DepositMethod) {
    setMethod(m);
    if (m === "online" && note.trim() === "") setNote("#");
    else if (m !== "online" && note === "#") setNote("");
  }

  async function handleSave() {
    const parsed = parsePricePaise(amountText);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.paise == null) {
      setError("Enter the amount received.");
      return;
    }
    if (!method) {
      setError("Pick how it was paid — Cash, Cheque or Online.");
      return;
    }
    if (!retailer) return; // unreachable — the form step requires a pick
    setSaving(true);
    setError(null);
    // An untouched "#" seed is not a note — never save it as one.
    const cleanNote = note.trim() === "#" ? "" : note.trim();
    try {
      if (isEdit) {
        await updateDeposit(editDeposit!.id, retailer.id, parsed.paise, method, cleanNote || undefined);
      } else {
        await createDeposit(retailer.id, parsed.paise, method, cleanNote || undefined);
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

        <label className={styles.fieldLabel}>AMOUNT RECEIVED</label>
        <label className={styles.amountField}>
          <span className={styles.amountPrefix}>₹</span>
          <input
            className={styles.amountInput}
            inputMode="decimal"
            value={amountText}
            placeholder="0"
            autoFocus={!isEdit}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>

        <label className={styles.fieldLabel}>HOW WAS IT PAID?</label>
        <div className={styles.methodSeg} role="group" aria-label="Method">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`${styles.methodBtn} ${method === m.value ? styles.methodBtnActive : ""}`}
              onClick={() => pickMethod(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label className={styles.fieldLabel}>NOTE · OPTIONAL</label>
        <input
          className={styles.noteInput}
          value={note}
          maxLength={200}
          placeholder="e.g. cheque no. / UPI ref"
          onChange={(e) => setNote(e.target.value)}
        />

        {error && <p className={styles.error}>{error}</p>}

        <Button variant="primary" onClick={handleSave} loading={saving}>
          {isEdit ? "Save changes" : "Save deposit"}
        </Button>
        {isEdit && (
          <Button variant="destructive" onClick={() => setConfirmVoid(true)} disabled={saving}>
            Void deposit
          </Button>
        )}
      </div>

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
