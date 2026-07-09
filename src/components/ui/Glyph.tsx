import type { LucideIcon } from "lucide-react";

// The app-wide glyph convention (orders-ui spec §1): lucide-react only
// (bundles locally, tree-shakes per import — no CDN, per our CSP posture),
// 18px, strokeWidth 1.75, aria-hidden — the glyph NEVER carries meaning
// alone; it always sits beside its text label ("icon + label, never
// icon-only").
export const GLYPH_SIZE = 18;
export const GLYPH_STROKE = 1.75;

export function Glyph({ icon: Icon, size = GLYPH_SIZE }: { icon: LucideIcon; size?: number }) {
  return <Icon size={size} strokeWidth={GLYPH_STROKE} aria-hidden />;
}
