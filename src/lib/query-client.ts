import { QueryClient, isServer } from "@tanstack/react-query";

// Client-data-cache spec (docs/specs/client-data-cache.md) D6 defaults:
// staleTime is a rapid-flip DEDUPE (~7s), not a freshness budget — every
// mount/focus older than that re-asks the server in the background; the page
// never waits on the answer. Focus/reconnect refetches ride TanStack's own
// focusManager/onlineManager (D6) — do NOT add visibilitychange/online
// listeners anywhere; two implementations of the same trigger double-fetch.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 7_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // One retry: salesman networks are flaky, but a failed background
        // refetch is non-fatal by design (D13 — the painted list stays).
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

// SECURITY (spec D2, bold rule): on the SERVER this MUST return a fresh
// QueryClient per request — a module-level singleton there would dehydrate one
// user's RLS-scoped rows into another user's HTML. The singleton is
// browser-only, where "global" means this one user's tab.
export function getQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
