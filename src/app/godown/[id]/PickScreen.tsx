"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Stepper } from "@/components/ui/Stepper";
import { extractSerial } from "@/lib/serial";
import { submitPick, OfflineError, type PickLineInput } from "@/lib/order-rpcs";
import { Scanner } from "./Scanner";
import styles from "./pick.module.css";

interface PickLine {
  id: string;
  name: string;
  qty: number;
  tally_name: string | null;
}

interface PickScreenProps {
  orderId: string;
  orderRef: string;
  retailerName: string;
  retailerArea: string | null;
  showModel: boolean;
  // Brand shape: LG (requires_scan) scans serials; fixed brands enter a picked
  // quantity per line. Partial is allowed either way (owner call) — the
  // remainder backorders server-side.
  requiresScan: boolean;
  lines: PickLine[];
  doneHref?: string;
}

// The pick screen — brand-aware + partial.
//   • LG: scan each physical unit's serial (or hand-type), stop whenever; a
//     short count backorders the rest. Submit is live as soon as ≥1 is scanned.
//   • Zeb/Lum: a per-line stepper for the picked qty (defaults to the full
//     ordered qty — the common all-in-stock case). Submit at ≥1.
// Scans accumulate client-side so a warehouse dead-spot never blocks picking;
// the authoritative checks (coverage-per-serial, within-bill uniqueness,
// split) run server-side in submit_pick. No prices on this screen.
export function PickScreen({
  orderId,
  orderRef,
  retailerName,
  retailerArea,
  showModel,
  requiresScan,
  lines,
  doneHref = "/godown",
}: PickScreenProps) {
  const router = useRouter();
  // LG: raw scans per line (raw strings go to the server verbatim; the chip
  // shows the client-side extraction, display-only).
  const [scans, setScans] = useState<Record<string, string[]>>({});
  // Fixed brands: picked qty per line, defaulting to the full ordered qty.
  const [picked, setPicked] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const l of lines) map[l.id] = l.qty;
    return map;
  });
  const [activeId, setActiveId] = useState<string>(lines[0]?.id ?? "");
  const [manualText, setManualText] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Short-pick guard: a partial submit opens a "PAKKA?" confirm first.
  const [confirmShort, setConfirmShort] = useState(false);
  const lastScanRef = useRef<{ text: string; at: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const countFor = (lineId: string) => scans[lineId]?.length ?? 0;
  const lineFor = (lineId: string) => lines.find((l) => l.id === lineId);
  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);
  const totalScanned = useMemo(() => Object.values(scans).reduce((sum, list) => sum + list.length, 0), [scans]);
  const totalPicked = useMemo(() => lines.reduce((sum, l) => sum + (picked[l.id] ?? 0), 0), [lines, picked]);

  // Progress depends on the mode. A pick of ANY size can be submitted now —
  // including ZERO, which sends the whole order back to backorder (owner
  // 2026-07-12). The "PAKKA?" confirm below guards a short/zero submit from
  // being an accident (it fires whenever shortfall > 0, i.e. anything less than
  // a full pick — zero included).
  const doneCount = requiresScan ? totalScanned : totalPicked;
  const shortfall = totalQty - doneCount;
  // LG: once every line is fully scanned, unmount the camera (also stops torch).
  const allScanned = lines.every((l) => countFor(l.id) === l.qty);

  const allSerials = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(scans)) for (const raw of list) set.add(extractSerial(raw).serial);
    return set;
  }, [scans]);

  function showFlash(message: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(message);
    flashTimer.current = setTimeout(() => setFlash(null), 3000);
  }

  // Returns true when the scan was counted (so callers can clear their input).
  function addScan(lineId: string, raw: string): boolean {
    const line = lineFor(lineId);
    const trimmed = raw.trim();
    if (!line || trimmed === "") return false;
    if (countFor(lineId) >= line.qty) {
      showFlash("Line full — tap the next line first.");
      return false;
    }
    const { serial } = extractSerial(trimmed);
    if (allSerials.has(serial)) {
      showFlash(`Serial ${serial} is already scanned on this order.`);
      return false;
    }
    setScans((prev) => ({ ...prev, [lineId]: [...(prev[lineId] ?? []), trimmed] }));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(60);
    return true;
  }

  function handleDecode(raw: string) {
    if (submitting) return;
    const { parsed } = extractSerial(raw);
    if (!parsed) return;
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.text === raw && now - last.at < 2500) return;
    lastScanRef.current = { text: raw, at: now };

    const active = lineFor(activeId);
    if (!active) return;
    if (countFor(activeId) >= active.qty) {
      showFlash("Line full — tap the next line first.");
      return;
    }
    addScan(activeId, raw);
  }

  function removeScan(lineId: string, index: number) {
    setScans((prev) => ({
      ...prev,
      [lineId]: (prev[lineId] ?? []).filter((_, i) => i !== index),
    }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setFlash(null);
    const payload: PickLineInput[] = requiresScan
      ? lines.map((l) => ({ order_item_id: l.id, scans: scans[l.id] ?? [] }))
      : lines.map((l) => ({ order_item_id: l.id, picked_qty: picked[l.id] ?? 0 }));
    try {
      await submitPick(orderId, payload);
      // replace, not push: the completed pick screen must VANISH from history
      // — pushing left …detail → scan → detail, and back from the new detail
      // returned to a spent scan screen (the owner's back-cycle, 2026-07-24).
      router.replace(doneHref);
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      if (error instanceof OfflineError) {
        showFlash("You're offline — your progress is safe on this screen. Try again when you have signal.");
      } else {
        showFlash(error instanceof Error ? error.message : "Could not submit the pick.");
      }
    }
  }

  // Submit tap: a SHORT pick (some units left) confirms first so it isn't
  // accidental; a full pick submits straight through (no extra tap).
  function onSubmitTap() {
    if (shortfall > 0) setConfirmShort(true);
    else void handleSubmit();
  }

  const activeLine = lineFor(activeId);

  function lineName(line: PickLine) {
    if (showModel && line.tally_name && line.tally_name !== line.name) {
      return (
        <>
          <span className={styles.lineModel}>{line.tally_name}</span>
          {"・"}
          {line.name}
        </>
      );
    }
    return line.name;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {/* TRUE back (instant router-cache restore) — doneHref stays the
            no-history fallback (deep-linked scan URL). Same owner call as the
            order-detail arrow, 2026-07-24. */}
        <BackLink fallback={doneHref} className={styles.back} aria-label="Back">
          ‹
        </BackLink>
        <div className={styles.headInfo}>
          <span className={styles.ref}>{orderRef}</span>
          <span className={styles.retailer}>
            {retailerName}
            {retailerArea ? ` · ${retailerArea}` : ""}
          </span>
        </div>
      </header>

      {/* LG only: the camera. Unmounting once every line is full also stops the
          camera + torch. Fixed brands never mount a scanner. */}
      {requiresScan && !allScanned && <Scanner onDecode={handleDecode} />}

      {flash && <p className={styles.flash}>{flash}</p>}

      <div className={styles.lines}>
        {lines.map((line) => {
          // ── Fixed brand: a qty stepper (no serials) ──
          if (!requiresScan) {
            const p = picked[line.id] ?? 0;
            return (
              <div key={line.id} className={styles.line}>
                <div className={styles.lineHead}>
                  <span className={styles.lineName}>{lineName(line)}</span>
                  <span className={`${styles.lineProgress} ${p === line.qty ? styles.lineDone : ""}`}>
                    {p === line.qty ? "✓ " : ""}
                    {p} / {line.qty}
                  </span>
                </div>
                <div className={styles.qtyRow}>
                  <Stepper
                    qty={p}
                    max={line.qty}
                    onChange={(next) => setPicked((prev) => ({ ...prev, [line.id]: next }))}
                    onTapQuantity={() => {}}
                  />
                </div>
              </div>
            );
          }

          // ── LG: scan against the active line ──
          const count = countFor(line.id);
          const full = count === line.qty;
          const active = line.id === activeId;
          return (
            <div key={line.id} className={`${styles.line} ${active ? styles.lineActive : ""}`}>
              <button type="button" className={styles.lineHead} onClick={() => setActiveId(line.id)}>
                <span className={styles.lineName}>{lineName(line)}</span>
                <span className={`${styles.lineProgress} ${full ? styles.lineDone : ""}`}>
                  {full ? "✓ " : ""}
                  {count} / {line.qty}
                </span>
              </button>

              {(scans[line.id] ?? []).length > 0 && (
                <div className={styles.chips}>
                  {(scans[line.id] ?? []).map((raw, index) => (
                    <span key={`${raw}-${index}`} className={styles.chip}>
                      {extractSerial(raw).serial}
                      <button
                        type="button"
                        className={styles.chipRemove}
                        onClick={() => removeScan(line.id, index)}
                        aria-label={`Remove ${extractSerial(raw).serial}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {active && !full && (
                <div className={styles.manualRow}>
                  <input
                    className={styles.manualInput}
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (addScan(line.id, manualText)) setManualText("");
                      }
                    }}
                    placeholder="Or type / scan a serial…"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (addScan(line.id, manualText)) setManualText("");
                    }}
                    disabled={manualText.trim() === ""}
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.submitBar}>
        <span className={styles.submitProgress}>
          {doneCount} / {totalQty} picked
          {shortfall > 0 ? ` · ${shortfall} to backorder` : ""}
          {requiresScan && !allScanned && activeLine ? ` · scanning ${activeLine.name}` : ""}
        </span>
        <Button variant="primary" onClick={onSubmitTap} loading={submitting}>
          Submit pick
        </Button>
      </div>

      {/* Short-pick confirm ("PAKKA?") — client-side guard only; submit_pick
          still does the real split server-side. Full picks never reach here. */}
      {confirmShort && (
        <BottomSheet onClose={() => setConfirmShort(false)}>
          <div className={styles.confirmAlert}>
            <span className={styles.confirmIcon} aria-hidden>
              ⚠️
            </span>
            <p className={styles.confirmTitle}>PAKKA?</p>
            <p className={styles.confirmBody}>
              Aapne {doneCount}/{totalQty} items hi add kiye hai.
            </p>
          </div>
          <div className={styles.confirmActions}>
            <Button variant="secondary" onClick={() => setConfirmShort(false)}>
              Nahi
            </Button>
            <Button
              variant="destructive-filled"
              onClick={() => {
                setConfirmShort(false);
                void handleSubmit();
              }}
            >
              Haan, submit karo
            </Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
