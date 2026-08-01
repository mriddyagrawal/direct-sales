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
  // Opt-in: go back to WHEREVER the reader came from, not only when that
  // happens to be `fallback`. Only sound for a label that names no
  // destination — a plain "Back" — because the strict check above exists
  // precisely to keep a label like "‹ Retailers" honest. Do not set this on
  // an arrow whose label promises a screen.
  //
  // Accepted cost (spec, retailer-detail-salesman-lens): the strict check was
  // also what kept a DRIFTED mirror safe (see nav-history — a forward button
  // or an unexpected traversal can diverge it). Loosened, a drifted mirror
  // lands the reader on an unexpected in-app screen rather than falling
  // through to the plain link. Rare, and the failure is "a different screen",
  // not a broken state. A COLD load is still safe either way: the mirror is
  // empty, previousPathname() is null, and the plain Link takes over.
  contextual?: boolean;
  className?: string;
  "aria-label"?: string;
  children: React.ReactNode;
}

export function BackLink({
  fallback,
  contextual = false,
  className,
  "aria-label": ariaLabel,
  children,
}: BackLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        // Modified clicks (new tab, etc.) keep plain-link semantics.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // Read the mirror HERE, in the handler — never during render. It is
        // client-only module state, so a render-time read would hydrate
        // differently from the server.
        const previous = previousPathname();
        if (previous === null) return; // nothing in-app behind us — plain Link
        if (contextual || previous === fallback) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
