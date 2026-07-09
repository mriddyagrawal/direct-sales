"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { extractSerial } from "@/lib/serial";
import { submitPick, OfflineError, type PickScan } from "@/lib/order-rpcs";
import { Scanner } from "./Scanner";
import styles from "./pick.module.css";

interface PickLine {
  id: string;
  name: string;
  qty: number;
}

interface PickScreenProps {
  orderId: string;
  orderRef: string;
  retailerName: string;
  retailerArea: string | null;
  lines: PickLine[];
}

// The pick screen: tap a line to make it active, scan each physical unit's
// serial barcode against it (or hand-type when a barcode won't read), then
// submit the whole pick in ONE batch — scans accumulate client-side so a
// warehouse dead-spot never blocks picking; the authoritative uniqueness/
// coverage checks run server-side in submit_pick. No prices on this screen.
export function PickScreen({ orderId, orderRef, retailerName, retailerArea, lines }: PickScreenProps) {
  const router = useRouter();
  // Raw scans per line — raw strings go to the server verbatim; the serial
  // shown in the chips is the client-side extraction (display only).
  const [scans, setScans] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string>(lines[0]?.id ?? "");
  const [manualText, setManualText] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lastScanRef = useRef<{ text: string; at: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const countFor = (lineId: string) => scans[lineId]?.length ?? 0;
  const lineFor = (lineId: string) => lines.find((l) => l.id === lineId);
  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);
  const totalScanned = useMemo(() => Object.values(scans).reduce((sum, list) => sum + list.length, 0), [scans]);
  const allComplete = lines.every((l) => countFor(l.id) === l.qty);

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
      showFlash("Line complete — tap the next line first.");
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
    // The content-filter (the targeting fix): LG boxes carry an EAN-13, a
    // model code, sometimes a QR. Only a decode matching the serial pattern
    // counts — anything else is SILENTLY ignored and the loop keeps scanning.
    // No fix-it card on the scan path; the deliberate override is the
    // per-line "Or type a serial…" field.
    const { parsed } = extractSerial(raw);
    if (!parsed) return;

    // The camera fires the same barcode repeatedly while it's in frame —
    // silently ignore an identical read within 2.5s instead of flashing a
    // duplicate error at someone still holding the box up.
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.text === raw && now - last.at < 2500) return;
    lastScanRef.current = { text: raw, at: now };

    const active = lineFor(activeId);
    if (!active) return;
    if (countFor(activeId) >= active.qty) {
      showFlash("Line complete — tap the next line first.");
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
    const payload: PickScan[] = lines.flatMap((l) =>
      (scans[l.id] ?? []).map((raw) => ({ order_item_id: l.id, raw_scan: raw })),
    );
    try {
      await submitPick(orderId, payload);
      router.push("/godown");
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      if (error instanceof OfflineError) {
        showFlash("You're offline — your scans are safe on this screen. Try again when you have signal.");
      } else {
        showFlash(error instanceof Error ? error.message : "Could not submit the pick.");
      }
    }
  }

  const activeLine = lineFor(activeId);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/godown" className={styles.back} aria-label="Back to queue">
          ‹
        </Link>
        <div className={styles.headInfo}>
          <span className={styles.ref}>{orderRef}</span>
          <span className={styles.retailer}>
            {retailerName}
            {retailerArea ? ` · ${retailerArea}` : ""}
          </span>
        </div>
      </header>

      {/* Unmounting the scanner once every line is full also stops the
          camera + torch + decode loop. */}
      {!allComplete && <Scanner onDecode={handleDecode} />}

      {flash && <p className={styles.flash}>{flash}</p>}

      <div className={styles.lines}>
        {lines.map((line) => {
          const count = countFor(line.id);
          const full = count === line.qty;
          const active = line.id === activeId;
          return (
            <div key={line.id} className={`${styles.line} ${active ? styles.lineActive : ""}`}>
              <button type="button" className={styles.lineHead} onClick={() => setActiveId(line.id)}>
                <span className={styles.lineName}>{line.name}</span>
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
                    placeholder="Or type a serial…"
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
          {totalScanned} / {totalQty} scanned
          {!allComplete && activeLine ? ` · scanning ${activeLine.name}` : ""}
        </span>
        <Button variant="primary" onClick={handleSubmit} disabled={!allComplete} loading={submitting}>
          Submit pick
        </Button>
      </div>
    </div>
  );
}
