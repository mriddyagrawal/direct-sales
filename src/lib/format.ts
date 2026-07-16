const IST_TIME_ZONE = "Asia/Kolkata";

export function istDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// IST times per the content rules in design/phase1-design-spec.md §4:
// "11:42" today, "Yesterday 16:03", or "06 Jul 2026, 11:42" otherwise.
export function formatOrderTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  const todayKey = istDateKey(now);
  if (istDateKey(date) === todayKey) return time;

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (istDateKey(date) === istDateKey(yesterday)) return `Yesterday ${time}`;

  const full = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
  return `${full}, ${time}`;
}

// Just the IST clock time ("14:30") — used by the grouped order HISTORY, where
// the date is carried once by the day-group header (formatHistoryDayHeader)
// instead of being repeated on every line.
export function formatOrderTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Day header for the grouped order HISTORY: "Today" / "Yesterday" / "10 Jul
// 2026". Relative for the two most recent days, absolute (unambiguous) beyond —
// so a history spanning weeks (e.g. a backorder punched later) is never guessy.
export function formatHistoryDayHeader(iso: string, now: Date = new Date()): string {
  const key = istDateKey(new Date(iso));
  if (key === istDateKey(now)) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === istDateKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

// Always the full "06 Jul 2026, 11:42" — unlike formatOrderTimestamp, never
// abbreviated to just a time. The pick-slip footer ("Printed ...") needs an
// unambiguous date even when printed today.
export function formatFullTimestamp(iso: string): string {
  const date = new Date(iso);
  const full = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${full}, ${time}`;
}

// Section labels for the order list: "TODAY · 06 JUL" or "EARLIER"
// (design spec S2), grouped by IST calendar day.
export function formatSectionLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (istDateKey(date) === istDateKey(now)) {
    const label = new Intl.DateTimeFormat("en-GB", {
      timeZone: IST_TIME_ZONE,
      day: "2-digit",
      month: "short",
    })
      .format(now)
      .toUpperCase();
    return `TODAY · ${label}`;
  }
  return "EARLIER";
}

export function isSameSectionKey(a: string, b: string, now: Date = new Date()): boolean {
  return formatSectionLabel(a, now) === formatSectionLabel(b, now);
}

// Compact IST date "16 Jul" (day + short month, no year) — the stock "as of"
// stamp on the admin list and the salesman's Quick Order card. Deliberately
// year-less: stock is a recent, frequently-refreshed figure, so the day+month
// reads cleaner; use formatFullTimestamp elsewhere when the year matters.
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

// ₹ en-IN grouping, e.g. 447800 paise -> "₹4,478" (whole rupees — this app
// never shows paise fractions; see money-display-paise-conversion memory).
export function formatRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}
