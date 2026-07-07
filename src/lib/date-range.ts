import type { DateRange } from "react-day-picker";

// Promoted from the /date-demo spike (34773e6) — pure date helpers, no
// date-fns coupling in our own code (react-day-picker carries its own copy;
// we don't import from a transitive dep).
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

interface Preset {
  label: string;
  // undefined = "All dates" (no date filter at all)
  range: () => DateRange | undefined;
}

export const PRESETS: Preset[] = [
  { label: "Today", range: () => ({ from: startOfDay(new Date()), to: startOfDay(new Date()) }) },
  { label: "Yesterday", range: () => ({ from: addDays(new Date(), -1), to: addDays(new Date(), -1) }) },
  { label: "Last 7 days", range: () => ({ from: addDays(new Date(), -6), to: startOfDay(new Date()) }) },
  { label: "Last 30 days", range: () => ({ from: addDays(new Date(), -29), to: startOfDay(new Date()) }) },
  { label: "This month", range: () => ({ from: startOfMonth(new Date()), to: startOfDay(new Date()) }) },
  { label: "All", range: () => undefined },
];

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "All dates";
  if (!range.to || startOfDay(range.from).getTime() === startOfDay(range.to).getTime()) return fmt(range.from);
  return `${fmt(range.from)} — ${fmt(range.to)}`;
}

// Is the selected range the same span as a preset? (drives the active highlight)
export function sameRange(a: DateRange | undefined, b: DateRange | undefined): boolean {
  const key = (r: DateRange | undefined) =>
    !r?.from ? "all" : `${startOfDay(r.from).getTime()}-${startOfDay(r.to ?? r.from).getTime()}`;
  return key(a) === key(b);
}

// A function, not a precomputed value — callers use it as a useState lazy
// initializer (e.g. `useState(DEFAULT_RANGE)`) so "now" is captured fresh on
// mount rather than frozen at module-eval time (matches the nowMs() pattern
// used elsewhere for the same reason — see lib/cart.ts).
export function DEFAULT_RANGE(): DateRange | undefined {
  return PRESETS[3].range(); // Last 30 days
}
