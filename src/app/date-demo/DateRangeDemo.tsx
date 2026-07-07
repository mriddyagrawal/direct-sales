"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { DateRangeFilter } from "@/app/dashboard/DateRangeFilter";
import { DEFAULT_RANGE } from "@/lib/date-range";

// Throwaway demo route — now just a thin local-state wrapper around the
// promoted DateRangeFilter (see src/app/dashboard/), kept alive only until
// commit 4 deletes this whole folder.
export function DateRangeDemo() {
  const [range, setRange] = useState<DateRange | undefined>(DEFAULT_RANGE);
  return <DateRangeFilter value={range} onChange={setRange} />;
}
