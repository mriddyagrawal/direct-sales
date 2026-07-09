"use client";

import { useState } from "react";
import { FilterDropdown } from "./FilterDropdown";
import type { BrandOption } from "./OrdersView";
import styles from "./SalesmanFilter.module.css";

interface BrandFilterProps {
  brands: BrandOption[];
  value: string; // "all" or a brand id
  onChange: (id: string) => void;
}

// S8 BRAND filter — same shared FilterDropdown shell as SALESMAN/DATE, and the
// same close-on-pick behaviour as SalesmanFilter (a brand pick is one complete
// action). Reuses SalesmanFilter's option-list styling.
export function BrandFilter({ brands, value, onChange }: BrandFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = brands.find((b) => b.id === value);
  const valueLabel = selected ? selected.name : "All brands";

  function select(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <FilterDropdown caption="BRAND" valueLabel={valueLabel} open={open} onOpenChange={setOpen}>
      <div className={styles.list}>
        <button
          type="button"
          className={`${styles.option} ${value === "all" ? styles.optionActive : ""}`}
          onClick={() => select("all")}
        >
          All brands
        </button>
        {brands.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`${styles.option} ${value === b.id ? styles.optionActive : ""}`}
            onClick={() => select(b.id)}
          >
            {b.name}
          </button>
        ))}
      </div>
    </FilterDropdown>
  );
}
