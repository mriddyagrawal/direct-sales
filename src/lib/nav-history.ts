// In-app navigation mirror — module-level, per-tab, reset on any hard load
// (exactly like the router cache it fronts). AuthCacheGuard feeds it on every
// route change; BackLink consults it to decide whether history.back() would
// land on the screen the arrow PROMISES (its fallback), or somewhere else.
//
// Why a mirror and not blind history.back(): the owner hit a real back-CYCLE
// (detail ‹ scan ‹ detail ‹ scan…) when a completed scan pushed a fresh detail
// entry — the stack contained the ping-pong and blind back walked it.
//
// The mirror is popstate-aware (owner follow-up, same day): a back traversal
// POPS the mirror instead of pushing, so after scan → back → detail the
// mirror correctly says the list is behind the detail and THAT back is
// instant too. A traversal whose destination doesn't match the mirror's
// previous entry (forward button, anything unexpected) is recorded as a
// normal move — the mirror may then diverge from real history, but only in
// the safe direction: BackLink falls through to its plain-Link fallback (one
// skeleton, guaranteed-right destination), never a wrong back.

let stack: string[] = [];
let popFlag = false;

// Called from a `popstate` listener — the next recorded route change was a
// history traversal, not a push.
export function flagPop(): void {
  popFlag = true;
}

// First mount of the tab — establishes the floor of the stack.
export function initPathname(pathname: string): void {
  if (stack.length === 0) stack = [pathname];
}

export function recordNavigation(pathname: string): void {
  if (popFlag && stack.length >= 2 && stack[stack.length - 2] === pathname) {
    stack.pop();
  } else {
    stack.push(pathname);
  }
  popFlag = false;
}

export function previousPathname(): string | null {
  return stack.length >= 2 ? stack[stack.length - 2] : null;
}
