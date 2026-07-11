"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./FilterDropdown.module.css";

interface FilterDropdownProps {
  caption: string;
  valueLabel: string;
  width?: number;
  children: ReactNode;
  // Both optional — omit for an uncontrolled dropdown that only closes on
  // outside-click/Esc (DateRangeFilter: the user keeps adjusting a range
  // inside the popover, so nothing should auto-close it). Pass both to let
  // the caller close it on selection (SalesmanFilter: pick an option, done).
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const MOBILE_BREAKPOINT = 768;
const VIEWPORT_MARGIN = 12; // popover inset from the screen edge on mobile

// Shared dropdown shell for the S8 filter row (DATE, SALESMAN) so every
// filter box is pixel-identical: fixed-width trigger [ CAPTION value ▾ ],
// popover below-left, dismiss on outside-click or Esc. This component owns
// only open/closed + positioning — callers own their own selection state.
export function FilterDropdown({
  caption,
  valueLabel,
  width,
  children,
  open: openProp,
  onOpenChange,
}: FilterDropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [mobileStyle, setMobileStyle] = useState<CSSProperties | null>(null);

  // Desktop: the popover is anchored purely via CSS (position:absolute,
  // below-left of the trigger — see .popover). Mobile: the filter row wraps
  // (flex-wrap), so a trigger can land anywhere horizontally; a CSS-only
  // anchor would overflow off one edge on a narrow screen. Measure the
  // trigger instead and pin the popover to the viewport edges. Only runs
  // while open — mobileStyle while closed is never read (the popover isn't
  // rendered at all then, guarded by `open &&` below), so there's nothing to
  // reset on close. useLayoutEffect (not useEffect) so the first open never
  // paints a stale position from a previous open/close cycle.
  // Because the popover is position:fixed on mobile, we must re-sync its `top`
  // on scroll too — otherwise it freezes at its open-time screen position while
  // the page (and the trigger) scroll away underneath it. Re-measuring on each
  // scroll frame keeps it glued below the trigger, so it rides up with the page
  // and scrolls off with it (rAF-throttled; capture:true catches nested
  // scrollers). Desktop hits the `null` branch → no re-render (Object.is).
  useLayoutEffect(() => {
    if (!open) return;
    function sync() {
      if (window.innerWidth >= MOBILE_BREAKPOINT || !triggerRef.current) {
        setMobileStyle(null);
        return;
      }
      const rect = triggerRef.current.getBoundingClientRect();
      setMobileStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: VIEWPORT_MARGIN,
        right: VIEWPORT_MARGIN,
        width: "auto",
      });
    }
    sync();
    let raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sync();
      });
    }
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", onScroll, true);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        style={width !== undefined ? { width } : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.triggerLabel}>{caption}</span>
        <span className={styles.triggerValue}>{valueLabel}</span>
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.popover} style={mobileStyle ?? undefined}>
          {children}
        </div>
      )}
    </div>
  );
}
