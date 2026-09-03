// WhatsApp-grammar delivery marks (owner-supplied SVGs, whatsapp-symbols/,
// 2026-09-03) — inlined as components so they ship in the bundle with zero
// asset requests. Stroke rides currentColor: the same CSS classes that
// coloured the old text glyphs colour these.

interface TickProps {
  size?: number;
}

export function TickSingle({ size = 14 }: TickProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.95 12.75 9.15 16.95 19.05 7.05" />
    </svg>
  );
}

export function TickDouble({ size = 14 }: TickProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.75 12.75 6.95 16.95M11.3 12.6 16.85 7.05M7.15 12.75 11.35 16.95 21.25 7.05" />
    </svg>
  );
}

export function TickCross({ size = 14 }: TickProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 7 17 17M17 7 7 17" />
    </svg>
  );
}
