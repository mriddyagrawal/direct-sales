import { ChevronLeft } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./FlowHeader.module.css";

interface FlowHeaderProps {
  title: string;
  subtitle?: string;
  // Optional right-hand slot, pinned to the far end of the ribbon. Quick Order
  // puts the shop's balance here. It sits BESIDE the title rather than under
  // it so the ribbon stays two lines tall on every screen that uses this
  // header — the title already truncates, so a long shop name yields space to
  // it rather than pushing it off.
  trailing?: React.ReactNode;
  onBack: () => void;
}

// Shared "back arrow + title (+ optional subtitle)" header across S3/S4/S5
// (design spec §3). No step language anywhere — the header's job is just
// navigation (the bottom tab bar hides during the order-taking flow) and,
// on S4, confirming which shop the order is for.
export function FlowHeader({ title, subtitle, trailing, onBack }: FlowHeaderProps) {
  return (
    <div className={styles.header}>
      {/* lucide ChevronLeft, the app's back glyph everywhere else (order
          detail and retailer detail both use it via back.module.css). This was
          a literal "←" at 20px in a 48-wide box — a different mark, twice the
          weight, eating 48px of a ribbon that has a shop name to fit. */}
      <button type="button" className={styles.back} onClick={onBack} aria-label="Back">
        <Glyph icon={ChevronLeft} />
      </button>
      <div className={styles.titles}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </div>
  );
}
