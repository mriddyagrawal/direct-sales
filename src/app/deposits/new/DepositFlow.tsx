"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import { PickRetailer, type SelectedRetailer } from "@/app/new-order/PickRetailer";
import { FlowHeader } from "@/components/ui/FlowHeader";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { parsePricePaise } from "@/lib/price";
import { formatRupees } from "@/lib/format";
import { readBalance } from "@/lib/balance";
import {
  depositNetPaise,
  parseDiscountPaise,
  methodNoteRule,
  findDuplicateReceipt,
  type ReceiptRefRow,
} from "@/lib/deposit-fields";
import { createDeposit, type DepositMethod } from "@/lib/deposit-rpcs";
import { createClient } from "@/lib/supabase/client";
import type { RetailerOption } from "@/app/new-order/page";
import styles from "./DepositFlow.module.css";

interface DepositFlowProps {
  retailers: RetailerOption[];
  recentRetailerIds: string[];
  salesmanId: string;
  // Role-aware landing after save (salesman → /deposits, staff →
  // /dashboard/deposits) — mirrors new-order's detailBase.
  returnTo: string;
}

const METHODS: { value: DepositMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "online", label: "Online" },
];

// New deposit — a deliberately tiny flow (owner 2026-07-19): pick the shop,
// type the amount, tap the method, save. Reuses PickRetailer wholesale.
// EDITING IS GONE (owner 2026-09-02): a wrong deposit is voided from the
// deposits list (reason required, 30-min creator window / admin anytime) and
// recorded again — the retailer's message history can never drift from the
// books.
export function DepositFlow({ retailers, recentRetailerIds, salesmanId, returnTo }: DepositFlowProps) {
  const router = useRouter();

  const [step, setStep] = useState<"retailer" | "form">("retailer");
  const [retailer, setRetailer] = useState<SelectedRetailer | null>(null);
  const [amountText, setAmountText] = useState("");
  const [discountText, setDiscountText] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [method, setMethod] = useState<DepositMethod | null>(null);
  const [note, setNote] = useState("");
  // The discount FOLD (owner 2026-09-03): collapsed for the 90% no-discount
  // case — "+ Add discount" opens the field, ✕ clears and refolds.
  const [discOpen, setDiscOpen] = useState(false);
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

  // Live derivation: net = amount − discount, recomputed on every keystroke —
  // the NET band and the save button both speak it (owner redesign 2026-09-03).
  const parsedAmount = parsePricePaise(amountText);
  const amountPaiseOrNull = parsedAmount.ok ? parsedAmount.paise : null;
  const parsedDiscount = parseDiscountPaise(discountText, amountPaiseOrNull);
  const netPaise =
    parsedAmount.ok && parsedAmount.paise != null && parsedDiscount.ok && parsedDiscount.paise != null
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

    // Duplicate check against the caller's own book. Advisory only: on
    // failure to fetch we save rather than trap the salesman behind a broken
    // warning.
    if (!skipDupCheck) {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("deposits")
          .select("id, deposit_ref, receipt_ref, amount_paise, created_at, voided_at")
          .eq("salesman_id", salesmanId)
          .not("receipt_ref", "is", null)
          .order("created_at", { ascending: false })
          .limit(500);
        const dup = findDuplicateReceipt((data ?? []) as ReceiptRefRow[], ref, null);
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
      await createDeposit(
        retailer.id, parsed.paise, method, ref, discount.paise ?? 0, null, cleanNote || undefined,
      );
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the deposit.");
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
        onBack={() => router.push(returnTo)}
      />
    );
  }

  const balPaise = retailers.find((x) => x.id === retailer?.id)?.outstanding_paise ?? null;
  const bal = readBalance(balPaise);

  return (
    <div className={styles.page}>
      <FlowHeader title="New deposit" onBack={() => router.push(returnTo)} />
      <div className={styles.content}>
        {/* WHO — the shop, its area, and the live Tally outstanding (house
            rule: null = "not synced", never ₹0, nothing rendered). The pencil
            square is the change affordance — the solid-accent grammar. */}
        <div className={styles.shopCard}>
          <div>
            <p className={styles.retailerName}>{retailer?.name}</p>
            {retailer?.area && <p className={styles.retailerArea}>{retailer.area}</p>}
            {bal.state !== "unknown" && (
              <p className={`${styles.retailerOut} ${bal.state === "owed" ? styles.retailerOutOwed : styles.retailerOutClear}`}>
                Outstanding: {bal.text}
              </p>
            )}
          </div>
          <button type="button" className={styles.changeSquare} aria-label="Change retailer" onClick={() => setStep("retailer")}>
            <Glyph icon={Pencil} size={15} />
          </button>
        </div>

        {/* Receipt number — inline: the words left, the #-box right. */}
        <label className={styles.receiptRow}>
          <span className={styles.receiptWords}>Receipt number</span>
          <span className={styles.receiptField}>
            <span className={styles.receiptHash}>#</span>
            {/* Numeric KEYPAD (approved mockup), free-text STORAGE — the
                keypad nudges digits without forbidding a book that carries a
                prefix; the DB column stays text either way. */}
            <input
              className={styles.receiptInput}
              value={receiptRef}
              maxLength={40}
              inputMode="numeric"
              placeholder="1043"
              autoFocus
              onChange={(e) => setReceiptRef(e.target.value)}
            />
          </span>
        </label>

        {/* THE MONEY CARD — gross giant, discount folded, NET celebrated.
            "GROSS" stays in the salesman's face (owner 2026-09-01): the full
            figure off the paper receipt, the amount the outstanding drops by. */}
        <div className={styles.moneyCard}>
          <div className={styles.grossBlock}>
            <span className={styles.grossTag}>GROSS AMOUNT</span>
            <label className={styles.grossEntry}>
              <span className={styles.grossRupee}>₹</span>
              <input
                className={styles.grossInput}
                inputMode="decimal"
                value={amountText}
                placeholder="0"
                onChange={(e) => setAmountText(e.target.value)}
              />
            </label>
          </div>
          <div className={styles.discRow}>
            {!discOpen ? (
              <button type="button" className={styles.discToggle} onClick={() => setDiscOpen(true)}>
                + Add discount
              </button>
            ) : (
              <span className={styles.discOpen}>
                <span className={styles.discLbl}>Discount</span>
                <span className={styles.discRupee}>− ₹</span>
                <input
                  className={styles.discInput}
                  inputMode="decimal"
                  value={discountText}
                  placeholder="0"
                  autoFocus
                  onChange={(e) => setDiscountText(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.discClear}
                  aria-label="Remove discount"
                  onClick={() => {
                    setDiscountText("");
                    setDiscOpen(false);
                  }}
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          <div className={styles.netBand}>
            <span className={styles.netLbl}>NET</span>
            <span className={styles.netFig}>{formatRupees(netPaise ?? 0)}</span>
          </div>
        </div>

        <p className={styles.zoneLabel}>PAYMENT METHOD</p>
        <div className={styles.methodSeg} role="group" aria-label="Payment method">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`${styles.methodBtn} ${styles[`method_${m.value}`]} ${method === m.value ? styles.methodOn : ""}`}
              onClick={() => setMethod(m.value)}
            >
              <span className={styles.methodDot} aria-hidden />
              {m.label}
            </button>
          ))}
        </div>

        {/* The note's identity follows the method (deposit-fields.ts): cheque
            no. / UPI ref are REQUIRED, cash keeps a small optional note. */}
        <label className={styles.zoneLabel} htmlFor="dep-note">
          {noteRule.label}
          {method && noteRule.required && <span className={styles.reqMark}> · REQUIRED</span>}
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
      </div>

      {/* Sticky save — the net rides the button: the thumb confirms the money. */}
      <div className={styles.saveBar}>
        <button type="button" className={styles.saveBtn} disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : (
            <>
              Save deposit — <span className={styles.saveAmt}>{formatRupees(netPaise ?? 0)}</span>
            </>
          )}
        </button>
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

    </div>
  );
}
