"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasInAppHistory } from "@/lib/nav-history";

// A back affordance that is a TRUE history-back when possible (owner call
// 2026-07-24: the edge-swipe felt right but is hard for less phone-fluent
// hands — the arrow should do the same thing). history.back() restores the
// previous screen instantly from the router's back/forward cache — no server
// wait, no skeleton (stable App Router behavior, not the experimental
// staleTimes knob); the query cache then corrects the data in place.
//
// Still a real <Link href={fallback}>: when this session has no in-app
// history (order detail opened as the first page — pasted URL, fresh tab),
// the click falls through to a normal navigation to the fallback route
// instead of backing out of the app.
interface BackLinkProps {
  fallback: string;
  className?: string;
  children: React.ReactNode;
}

export function BackLink({ fallback, className, children }: BackLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className={className}
      onClick={(e) => {
        // Modified clicks (new tab, etc.) keep plain-link semantics.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (hasInAppHistory()) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
