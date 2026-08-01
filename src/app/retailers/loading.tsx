import { Skeleton } from "@/components/ui/Skeleton";
import shell from "@/components/ui/tab-shell.module.css";

// Skeleton, never a spinner (design spec S2/S8), and the tab bar's <Link> warms
// THIS file — so without it the tab tap pays full latency.
//
// Shape follows RetailerList: the search field, a section label, then rows that
// are mostly ONE line. Only a couple carry a second line, because 582 of 599
// shops have no area — a skeleton that drew two lines everywhere would promise
// a denser screen than the one that arrives.
export default function Loading() {
  return (
    <div className={shell.page}>
      <div className={shell.content} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Search: the Field's label sits above its 44px box. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Skeleton width={54} height={10} />
          <Skeleton height={44} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Skeleton width={70} height={10} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 4px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <Skeleton width={`${42 + ((i * 11) % 28)}%`} height={17} />
                <Skeleton width={64} height={13} />
              </div>
              {/* The occasional second line, matching how rare an area is. */}
              {i % 4 === 1 && <Skeleton width={90} height={12} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
