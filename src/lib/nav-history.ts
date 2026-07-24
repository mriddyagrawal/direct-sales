// In-app navigation counter — module-level, per-tab, reset on any hard load
// (exactly like the router cache it fronts). AuthCacheGuard increments it on
// every route change; BackLink consults it to decide whether history.back()
// has an in-app entry to land on. Deliberately NOT window.history.length:
// in a browser tab that arrived from elsewhere (pasted order URL), length > 1
// even though "back" would exit the app.

let navCount = 0;

export function recordNavigation(): void {
  navCount += 1;
}

export function hasInAppHistory(): boolean {
  return navCount > 0;
}
