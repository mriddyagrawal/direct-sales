# Future Plans — unscheduled parking lot

Ideas the owner has approved in principle but deliberately **not** scheduled into [PLAN.md](../PLAN.md)'s committed phases. Each entry records the decided shape and the decision context so it never gets re-litigated. When an entry is scheduled, move it into PLAN.md as a phase/milestone and delete it here.

## Order-punch geotagging (owner-approved 2026-07-06 · late phase)

**What:** capture one GPS fix at the moment a salesman submits an order and store it on the order; the dashboard shows a map link and distance-from-expected context on the order detail.

**Decided shape (locked with the owner):**

- **Order-submit tags only.** No retailer coordinates — the owner explicitly ruled out geotagging shops. If that ever changes, it's a separate decision.
- **Fail-open, always.** `getCurrentPosition` runs *in parallel* with submit; the fix is attached if it arrives within ~5s, otherwise the order submits without one. A missing tag is a soft signal — never an error, never a blocked or slowed submit. The "faster than the notebook" rule outranks the geotag.
- **Quiet presentation.** A map link on the dashboard order detail — no alarms, no "far from shop" enforcement rules. GPS is 20–150m accurate in bazaar/shop conditions and the coordinates are client-supplied (a trust signal, not proof), so rules built on top would be theater. This also manages the adoption risk: visible surveillance is the classic killer of field-sales apps.
- **Web-app limit, for expectations:** a browser app gets location only at interaction moments after a one-time permission prompt. Background route tracking is impossible without a native app — out of this stack, and out of scope.

**Schema when scheduled** (additive, cheap — nothing pre-built now): nullable `orders.submit_lat`, `orders.submit_lng`, `orders.submit_accuracy_m`; the `submit_order` RPC accepts them as optional client-supplied fields (unlike prices, only the client can know them; validate ranges, store as-is).

**Revisit when:** the Phase 1 pilot has proven adoption (post-M6), or the first "was he really at the shop?" dispute makes the data worth having.
