"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { initPathname, recordNavigation } from "@/lib/nav-history";

// D9 (client-data-cache spec): ANY transition to signed-out wipes the data
// cache and hard-navigates to /login — button, refresh-token expiry, kicked
// session, all paths. The hard navigation (not router.push) tears down the
// whole JS heap, so nothing cached can outlive the session.
//
// Also D9's bfcache buster: iOS/WebKit can restore the previous page from the
// back-forward cache with ZERO network after a hard nav — `no-store` does not
// reliably prevent it on iOS, and this is a phone PWA. A page restored from
// bfcache reports pageshow.persisted=true; reload it so the proxy re-checks
// auth and no post-sign-out screen can be resurrected.
export function AuthCacheGuard() {
  const queryClient = useQueryClient();

  // Feed the in-app navigation sequence (see src/lib/nav-history.ts): the
  // initial mount establishes "current" without inventing a previous; every
  // later route change records the move so BackLink knows what's behind it.
  const pathname = usePathname();
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      initPathname(pathname);
      return;
    }
    recordNavigation(pathname);
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      queryClient.clear();
      // Already on /login (e.g. the guard fired from the sign-out flow that
      // also navigates): clearing was the job; don't navigate in a loop.
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    });

    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", onPageShow);

    return () => {
      authSub.subscription.unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [queryClient]);

  return null;
}
