"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { previousPathname } from "@/lib/nav-history";

// A back affordance with the ORIGINAL Link semantics — it always lands on
// `fallback` — that upgrades to a true history.back() exactly when the screen
// behind this one IS the fallback (the tapped-a-row-in-the-list case). Then
// the previous screen restores instantly from the router's back/forward cache
// (no server wait, no skeleton — stable App Router behavior, no experimental
// flag) and the query cache corrects its data in place.
//
// When history leads anywhere else — a post-submit push landed here, a
// deep-linked first page, a detail reached from another detail — the click
// falls through to the plain Link: one skeleton, guaranteed-right
// destination. Owner-repro'd cycle this prevents (2026-07-24): after a pick,
// history was …detail → scan → detail, and a blind back ping-ponged
// detail ‹ scan ‹ detail forever.
interface BackLinkProps {
  fallback: string;
  className?: string;
  "aria-label"?: string;
  children: React.ReactNode;
}

export function BackLink({ fallback, className, "aria-label": ariaLabel, children }: BackLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        // Modified clicks (new tab, etc.) keep plain-link semantics.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (previousPathname() === fallback) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
