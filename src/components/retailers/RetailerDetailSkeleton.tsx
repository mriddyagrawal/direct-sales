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
//    boundary has nothing to prefetch and the tap pays full latency.
//
// Structure mirrors the LEDGER page: identity, the claim under its 2px rule,
// then a statement of hairline rows. The fact table it used to mirror is gone.
export function RetailerDetailSkeleton({ role }: { role: "salesman" | "staff" }) {
  const isStaff = role === "staff";

  return (
    <div className={styles.page} aria-hidden>
      <div className={back.row}>
        {/* An 18px chevron + the word "Back" in 17px mono. */}
        <Skeleton width={66} height={18} />
      </div>

      <div className={styles.headRow}>
        <div className={styles.identity}>
          <Skeleton width="min(340px, 70%)" height={26} />
          {/* The contact line — present on the minority of shops that have an
              area or a phone, but the skeleton cannot know which, and a bar
              that sometimes resolves to nothing is better than a jump. */}
          <div style={{ marginTop: 6 }}>
            <Skeleton width={120} height={13} />
          </div>
        </div>
        {/* Edit is staff-only, so its placeholder is too. */}
        {isStaff && <Skeleton width={96} height={44} className={styles.headRowAction} />}
      </div>

      {/* The claim: the big figure under its rule. */}
      <div className={styles.claim}>
        <Skeleton width={190} height={34} />
        <div style={{ marginTop: 7 }}>
          <Skeleton width={150} height={11} />
        </div>
      </div>

      {/* The statement: a header rule, then rows. Four is the median shop —
          entries run 1 to 50, averaging 8, so four bars promise less than most
          shops have rather than more. */}
      <div className={styles.statement}>
        <div className={styles.statementHead}>
          <Skeleton width={80} height={11} />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.entry}>
            <div className={styles.entryLeft}>
              <Skeleton width={54} height={11} />
              <div style={{ marginTop: 3 }}>
                <Skeleton width={`${45 + ((i * 13) % 30)}%`} height={14} />
              </div>
            </div>
            <Skeleton width={74} height={14} />
          </div>
        ))}
      </div>
    </div>
  );
}
