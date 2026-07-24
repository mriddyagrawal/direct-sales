"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/query-client";

// App-wide TanStack Query provider (client-data-cache spec, Piece 1).
// getQueryClient() is called in render (not useState) per the official App
// Router pattern: React may throw away the render before commit, and a
// useState initializer would strand a client mid-suspense; the module-level
// browser singleton survives either way.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Devtools ship a production no-op export, but gating the render keeps
          even that out of the tree outside dev. */}
      {process.env.NODE_ENV === "development" ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
