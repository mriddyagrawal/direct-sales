import { Skeleton } from "@/components/ui/Skeleton";

// Shape-matched fallback for the shared OrderDetailView (used by both
// /orders/[id] and /dashboard/orders/[id]). Presentation-only, renders
// instantly. Layout is inline — a throwaway skeleton earns no CSS module.
export function OrderDetailSkeleton() {
  return (
    // Container mirrors OrderDetailView.module.css `.page` — padding 16, flex
    // column, gap 16, and NO max-width. It used to carry `maxWidth: 720,
    // margin: "0 auto"`, which the real page has never had: on desktop the
    // skeleton painted as a narrow centred strip and the order then snapped
    // out to full width. Invisible until the order-row prefetch made the
    // boundary actually paint on click (owner repro 2026-08-01).
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, width: "100%" }} aria-hidden>
      {/* Back eyebrow */}
      <Skeleton width={96} height={14} />

      {/* Ref + retailer hero */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton width={140} height={22} />
        <Skeleton width={220} height={28} />
        {/* The shop's balance line, added to the hero 2026-08-01. Without a bar
            for it the hero grew by ~20px on arrival and the actions jumped.
            Note it is hidden on the GODOWN lens, which shares this skeleton —
            so godown briefly shows one bar too many. Untyped by design: this
            component takes no role, and a prop for one bar is not worth it. */}
        <Skeleton width={190} height={20} />
        <Skeleton width={160} height={14} />
      </div>

      {/* Action buttons. Widths are EXPLICIT: Skeleton defaults to width 100%,
          so two bare <Skeleton/>s in a flex row each demanded the full
          container — 200% of it — and the second ran off the right edge of the
          window. calc(50% - 4px) each exactly absorbs the 8px gap. */}
      <div style={{ display: "flex", gap: 8 }}>
        <Skeleton width="calc(50% - 4px)" height={44} />
        <Skeleton width="calc(50% - 4px)" height={44} />
      </div>

      {/* Items table: header + 4 line rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        <Skeleton width="100%" height={12} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <Skeleton width="46%" height={16} />
            <Skeleton width={44} height={16} />
            <Skeleton width={64} height={16} />
            <Skeleton width={72} height={16} />
          </div>
        ))}
      </div>

      {/* Total bar */}
      <Skeleton width="100%" height={20} />

      {/* History */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <Skeleton width={72} height={12} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={`${70 - i * 12}%`} height={14} />
        ))}
      </div>
    </div>
  );
}
