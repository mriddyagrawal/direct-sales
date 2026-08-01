import { Skeleton } from "@/components/ui/Skeleton";
import back from "@/components/ui/back.module.css";
import styles from "./RetailerDetail.module.css";

// Retailer detail loading boundary.
//
// This exists for two reasons, and the second is the load-bearing one.
//
// 1. It is what the reader sees during the server round-trip, instead of the
//    previous screen sitting there looking unresponsive (design spec S2/S8:
//    skeletons, never spinners).
//
// 2. For a DYNAMIC route, the loading boundary is *the thing Next prefetches*.
//    `<Link>` warms this file — never the retailer's data — so with no
//    boundary here the queue's row links had nothing to prefetch and the tap
//    paid full latency. Deleting this file silently makes navigation feel
//    slower without breaking anything, which is the worst kind of regression.
//
// Structure mirrors RetailerDetail exactly — same wrappers, same class names —
// so the skeleton occupies the real layout and the page does not jump when the
// content arrives.
export default function Loading() {
  return (
    <div className={styles.page}>
      {/* Same shared band the real page uses, so the 24px floor and the
          headline's compensating pull-up apply here too — the skeleton must
          occupy the real layout or the title jumps when content lands. */}
      <div className={back.row}>
        {/* Sized for the real affordance: an 18px chevron + the word "Back"
            in 17px mono, not the old 12px "‹ Retailers". */}
        <Skeleton width={66} height={18} />
      </div>
      <div className={styles.headRow}>
        <Skeleton width="min(340px, 70%)" height={26} />
      </div>
      <dl className={styles.facts}>
        {["Area", "Phone", "Tally ledger name"].map((label) => (
          <div key={label} className={styles.fact}>
            <Skeleton width={110} height={11} />
            <Skeleton width="min(260px, 55%)" height={14} />
          </div>
        ))}
      </dl>
    </div>
  );
}
