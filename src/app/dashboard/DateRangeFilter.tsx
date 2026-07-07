"use client";

import { useMemo, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { FilterDropdown } from "./FilterDropdown";
import { PRESETS, rangeLabel, sameRange } from "@/lib/date-range";
import { nowMs } from "@/lib/cart";
import styles from "./DateRangeFilter.module.css";

interface DateRangeFilterProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}

// S8 DATE filter — the react-day-picker range calendar promoted from the
// /date-demo spike, themed to the instrument grammar (accent range, 2px
// square cells, mono day numbers). Controlled: holds no range state of its
// own, so OrdersList (and /date-demo's local wrapper) own the selection.
// Stays open after picking a preset/day — the popover only dismisses on
// outside-click/Esc (FilterDropdown's default), since the user may still be
// dragging a range.
export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  // useState(nowMs) + new Date(numeric) — not new Date() directly in the
  // render body — keeps this pure (react-hooks/purity); see OrderWorkbench's
  // identical pattern.
  const [tick] = useState(nowMs);
  const today = useMemo(() => new Date(tick), [tick]);

  return (
    <FilterDropdown caption="DATE" valueLabel={rangeLabel(value)}>
      <div className={styles.panel}>
        <div className={styles.presets}>
          {PRESETS.map((p) => {
            const pr = p.range();
            return (
              <button
                key={p.label}
                type="button"
                className={`${styles.preset} ${sameRange(value, pr) ? styles.presetActive : ""}`}
                onClick={() => onChange(pr)}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className={styles.calendarSide}>
          <div className={styles.calendarWrap}>
            <DayPicker mode="range" numberOfMonths={1} selected={value} onSelect={onChange} defaultMonth={value?.from ?? today} />
          </div>
          <div className={styles.readout}>
            <span className={styles.readoutLabel}>SELECTED</span>
            <span className={styles.readoutValue}>{rangeLabel(value)}</span>
          </div>
        </div>
      </div>
    </FilterDropdown>
  );
}
