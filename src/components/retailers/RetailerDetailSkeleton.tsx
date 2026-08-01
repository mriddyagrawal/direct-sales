import { Skeleton } from "@/components/ui/Skeleton";
import back from "@/components/ui/back.module.css";
import styles from "./RetailerDetail.module.css";

// Shape-matched fallback for the shared RetailerDetail, used by BOTH lenses'
// loading.tsx — the same arrangement OrderDetailSkeleton has with the two
// order-detail routes. One copy, so the two skeletons cannot drift apart from
// each other or from the page.
//
// It exists for two reasons, and the second is the load-bearing one.
//
// 1. It is what the reader sees during the server round-trip, instead of the
//    previous screen sitting there looking unresponsive (design spec S2/S8:
//    skeletons, never spinners).
//
// 2. For a DYNAMIC route, the loading boundary is *the thing Next prefetches*.
//    <Link> warms this file — never the retailer's data — so a route with no
//    boundary has nothing to prefetch and the tap pays full latency. Deleting
//    it silently makes navigation feel slower without breaking anything, which
//    is the worst kind of regression.
//
// Structure mirrors RetailerDetail exactly — same wrappers, same class names,
// same lens rules — so the skeleton occupies the real layout and nothing jumps
// when the content arrives. That includes .headRow's 48px floor and its
// compensating pull-up, which is what keeps the shop name on the same y as the
// shop name on order detail.
export function RetailerDetailSkeleton({ role }: { role: "salesman" | "staff" }) {
  const isStaff = role === "staff";
  // Exactly the rows the real page renders for this lens: the Tally ledger
  // name is editor-only, and the salesman lens has no editing.
  const labels = isStaff ? ["Area", "Phone", "Tally ledger name"] : ["Area", "Phone"];

  return (
    <div className={styles.page} aria-hidden>
      <div className={back.row}>
        {/* An 18px chevron + the word "Back" in 17px mono. */}
        <Skeleton width={66} height={18} />
      </div>
      <div className={styles.headRow}>
        <Skeleton width="min(340px, 70%)" height={26} />
        {/* Edit is staff-only, so its placeholder is too — a bar on the
            salesman lens would promise a button that never arrives. Widths are
            explicit because Skeleton defaults to width: 100%. */}
        {isStaff && <Skeleton width={96} height={44} className={styles.headRowAction} />}
      </div>
      <dl className={styles.facts}>
        {labels.map((label) => (
          <div key={label} className={styles.fact}>
            <Skeleton width={110} height={11} />
            <Skeleton width="min(260px, 55%)" height={14} />
          </div>
        ))}
      </dl>
    </div>
  );
}
