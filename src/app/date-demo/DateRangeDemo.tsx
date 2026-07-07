"use client";

import { useEffect, useRef, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import styles from "./DateRangeDemo.module.css";

// Plain-JS date helpers — no date-fns coupling in our own code (the library
// carries its own copy; we don't import from a transitive dep).
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

interface Preset {
  label: string;
  // undefined = "All dates" (no date filter at all)
  range: () => DateRange | undefined;
}

const PRESETS: Preset[] = [
  { label: "Today", range: () => ({ from: startOfDay(new Date()), to: startOfDay(new Date()) }) },
  { label: "Yesterday", range: () => ({ from: addDays(new Date(), -1), to: addDays(new Date(), -1) }) },
  { label: "Last 7 days", range: () => ({ from: addDays(new Date(), -6), to: startOfDay(new Date()) }) },
  { label: "Last 30 days", range: () => ({ from: addDays(new Date(), -29), to: startOfDay(new Date()) }) },
  { label: "This month", range: () => ({ from: startOfMonth(new Date()), to: startOfDay(new Date()) }) },
  { label: "All", range: () => undefined },
];

const fmt = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "All dates";
  if (!range.to || startOfDay(range.from).getTime() === startOfDay(range.to).getTime()) return fmt(range.from);
  return `${fmt(range.from)} — ${fmt(range.to)}`;
}

// Is the selected range the same span as a preset? (drives the active highlight)
function sameRange(a: DateRange | undefined, b: DateRange | undefined): boolean {
  const key = (r: DateRange | undefined) =>
    !r?.from ? "all" : `${startOfDay(r.from).getTime()}-${startOfDay(r.to ?? r.from).getTime()}`;
  return key(a) === key(b);
}

export function DateRangeDemo() {
  // Default view = Last 30 days.
  const [range, setRange] = useState<DateRange | undefined>(PRESETS[3].range());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside-click or Esc — standard dropdown dismissal.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        <span className={styles.triggerLabel}>DATE</span>
        <span className={styles.triggerValue}>{rangeLabel(range)}</span>
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.panel}>
            <div className={styles.presets}>
              {PRESETS.map((p) => {
                const pr = p.range();
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`${styles.preset} ${sameRange(range, pr) ? styles.presetActive : ""}`}
                    onClick={() => setRange(pr)}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className={styles.calendarSide}>
              <div className={styles.calendarWrap}>
                <DayPicker
                  mode="range"
                  numberOfMonths={1}
                  selected={range}
                  onSelect={(r) => setRange(r)}
                  defaultMonth={range?.from ?? new Date()}
                />
              </div>
              <div className={styles.readout}>
                <span className={styles.readoutLabel}>SELECTED</span>
                <span className={styles.readoutValue}>{rangeLabel(range)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
