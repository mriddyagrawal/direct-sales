// In-app navigation sequence — module-level, per-tab, reset on any hard load
// (exactly like the router cache it fronts). AuthCacheGuard feeds it on every
// route change; BackLink consults it to decide whether history.back() would
// land on the screen the arrow PROMISES (its fallback), or somewhere else.
//
// Why "previous pathname" and not a history mirror or window.history.length:
// the owner hit a real back-CYCLE (detail ‹ scan ‹ detail ‹ scan…) when a
// completed scan pushed a fresh detail entry — blind history.back() walks
// whatever the stack contains. The rule that kills the whole class: the arrow
// uses the instant back-restore ONLY when the sequence says the screen behind
// is exactly the arrow's target; otherwise it navigates to the target like the
// plain Link it wraps. Sequence-tracking is deliberately conservative (a back
// navigation records like any other move) — the conservative miss costs one
// skeleton, never a wrong destination.

let prevPathname: string | null = null;
let currentPathname: string | null = null;

// First mount of the tab — establishes "current" without inventing a previous.
export function initPathname(pathname: string): void {
  if (currentPathname === null) currentPathname = pathname;
}

export function recordNavigation(pathname: string): void {
  prevPathname = currentPathname;
  currentPathname = pathname;
}

export function previousPathname(): string | null {
  return prevPathname;
}
