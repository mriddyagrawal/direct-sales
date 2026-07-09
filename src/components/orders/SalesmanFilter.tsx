"use client";

import { useState } from "react";
import { FilterDropdown } from "./FilterDropdown";
import type { SalesmanOption } from "./OrdersView";
import styles from "./SalesmanFilter.module.css";

interface SalesmanFilterProps {
  salesmen: SalesmanOption[];
  value: string; // "all" or a salesman id
  onChange: (id: string) => void;
}

// S8 SALESMAN filter — same shared FilterDropdown shell as DATE, so the two
// boxes are visually identical. Unlike DateRangeFilter (stays open for
// further range adjustment), this one closes itself the moment an option
// is picked — a salesman pick is a single, complete action.
export function SalesmanFilter({ salesmen, value, onChange }: SalesmanFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = salesmen.find((s) => s.id === value);
  const valueLabel = selected ? selected.full_name : "All";

  function select(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <FilterDropdown caption="SALESMAN" valueLabel={valueLabel} open={open} onOpenChange={setOpen}>
      <div className={styles.list}>
        <button
          type="button"
          className={`${styles.option} ${value === "all" ? styles.optionActive : ""}`}
          onClick={() => select("all")}
        >
          All
        </button>
        {salesmen.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`${styles.option} ${value === s.id ? styles.optionActive : ""}`}
            onClick={() => select(s.id)}
          >
            {s.full_name}
          </button>
        ))}
      </div>
    </FilterDropdown>
  );
}
