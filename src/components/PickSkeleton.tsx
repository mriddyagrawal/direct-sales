import { Skeleton } from "@/components/ui/Skeleton";

// Shape-matched fallback for the godown pick / universal-scan screens (used by
// both /godown/[id] and /scan/[id], which both render PickScreen). Layout is
// inline — a throwaway skeleton earns no CSS module — but every number here is
// copied from pick.module.css, so a change there has to be mirrored here.
//
// REVIEWER flag 62: this used to be `padding: 16, maxWidth: 720,
// margin: "0 auto"` while PickScreen's `.page` is
// `min-height: 100vh; padding: 0 16px 96px` with NO cap and no centring.
// Nothing above it caps the width either — there is no godown or scan layout,
// only the root one — so the skeleton was the sole source of the mismatch:
// on a wide screen it painted a narrow centred column that snapped out to full
// width, and on every screen its 16px of top padding pushed the header down so
// the content jumped UP when it arrived. The 96px bottom is what reserves room
// for the fixed submit bar.
//
// NO background here, deliberately, and it is not an oversight: `.page` sets
// --color-paper but so does `body` in globals.css, so there is nothing to
// flash against and repeating it would be cargo cult.
export function PickSkeleton() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px 96px",
        width: "100%",
      }}
      aria-hidden
    >
      {/* Header — a FULL-BLEED white band, not a couple of bars on paper. The
          negative side margins cancel the page's 16px padding exactly as
          `.header` does, and the 48px box is the back arrow's touch target
          (--touch-target-min), which is what makes the band ~65px tall. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          margin: "0 -16px",
          padding: "8px 16px 8px 4px",
          background: "var(--color-white)",
          borderBottom: "1px solid var(--color-hairline)",
        }}
      >
        <div style={{ width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Skeleton width={10} height={24} />
        </div>
        {/* Order ref over retailer · area, the two lines `.headInfo` stacks. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Skeleton width={110} height={14} />
          <Skeleton width={170} height={12} />
        </div>
      </div>

      {/* Camera. `.cameraWrap` is 280px with a 12px top margin — it was 240px
          with a 16px flex gap. Only scan-required brands mount a scanner, so
          on a fixed brand this block has nothing to become; that was already
          true of the old skeleton and is not worth guessing about here, since
          the route cannot know the brand before the data arrives. */}
      <div style={{ marginTop: 12 }}>
        <Skeleton width="100%" height={280} />
      </div>

      {/* Lines. `.lines` is margin-top 12 + gap 8; each `.line` is a 48px
          touch row plus 8px of padding top and bottom = 64px, not 56. */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {[0, 1].map((i) => (
          <Skeleton key={i} width="100%" height={64} />
        ))}
      </div>

      {/* The submit bar renders unconditionally and is position: fixed, so it
          cannot shift anything above it — but leaving it out meant a heavy
          white band with a 2px ink top rule POPPED into the bottom of the
          screen on load. Same geometry as `.submitBar`. */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          background: "var(--color-white)",
          borderTop: "2px solid var(--color-ink)",
        }}
      >
        <Skeleton width={120} height={12} />
        <Skeleton width={140} height={48} />
      </div>
    </div>
  );
}
