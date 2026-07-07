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

// Countdown chip text (minutes only, never seconds — design spec §2 "Status
// system"): "editable 1h 12m" / "editable 8m". null once the window has
// passed (the caller then shows the locked chip instead).
export function formatCountdown(
  editableUntilIso: string,
  now: Date = new Date(),
): { label: string; urgent: boolean } | null {
  const diffMs = new Date(editableUntilIso).getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `editable ${hours}h ${minutes}m` : `editable ${minutes}m`;

  return { label, urgent: totalMinutes < 10 };
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
