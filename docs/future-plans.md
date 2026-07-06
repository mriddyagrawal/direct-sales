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

**Idempotency interaction (pinned per the 6d81e88 review):** `submit_order` retries with an existing `id` return the order untouched — so **the geotag rides the first successful submit only; retries never update it**. If the first attempt lands without a fix and a retry arrives with one, the fix is discarded. That is acceptable (the tag is a soft signal); do not weaken the idempotency rule to merge coordinates.

**Revisit when:** the Phase 1 pilot has proven adoption (post-M6), or the first "was he really at the shop?" dispute makes the data worth having.

## RLS/index performance pass (flagged 2026-07-07, M1)

**What:** four `get_advisors(performance)` findings from the M1 Supabase build, left unfixed on purpose — all confirmed harmless at current scale, not silently missed (see the M1.6/M1.6b review blocks in [comments.md](../comments.md)):

1. **Multiple permissive RLS policies per table/action** — e.g. `products_select_salesman` + `products_select_staff` are two separate `SELECT` policies Postgres ORs together, instead of one combined `using (... or ...)` clause. Kept split for matrix-auditability (each policy documents one role's rule).
2. **`auth_profile_role()` / `auth.uid()` called unwrapped inside RLS policies** instead of `(select auth_profile_role())` — the wrapped form lets the planner evaluate it once per query instead of once per row scanned.
3. **Five foreign keys without a covering index:** `order_events.actor_id`, `order_items.product_id`, `orders.processed_by`, `orders.retailer_id`, `retailers.created_by`.
4. (informational only, not a fix candidate) unused-index noise on a near-empty table — resolves itself once real order volume exists.

**Decision context:** none of this matters at D6 scale (1–2 salesmen, <20 orders/day, the whole `products` table is 42 rows) — fixing it now would be optimizing a query that touches a few dozen rows. It becomes worth doing if either (a) real order/retailer volume grows meaningfully past the Phase 1 pilot, or (b) the app stays on Supabase's **Free tier** (smaller shared compute than Pro) for an extended period — free tier doesn't cause these, but it shrinks the headroom before any of them would show up as observable latency. All four are mechanical, low-risk fixes with zero schema/behavior change (rewrite ~10 `CREATE POLICY` statements to combine clauses and wrap auth calls, add 5 indexes).

**Revisit when:** alongside the Supabase Pro upgrade decision (PLAN.md open question #5), or if `get_advisors(performance)` warnings start correlating with actually-observed slowness.

## "Cancelled orders" view for the salesman (flagged 2026-07-07)

**What:** D8 (decisions.md) hides a salesman's self-cancelled orders from their default order list. This entry is the *un-hide* — a dedicated screen/filter toggle so a salesman can go look at their own cancelled orders if they ever want to (e.g. "did I actually cancel that Sharma Electronics order, or did it go through?").

**Decision context:** not approved or rejected — genuinely unknown whether salesmen will ever ask for this. The data supports it with zero backend work (the row, event trail, and RLS `SELECT own` policy already exist and already include cancelled orders — D8 is purely a client-side query filter, so removing the filter for this one screen is the entire implementation). Parked rather than speced because building a screen nobody asks for is wasted design/eng time the notebook-beating metric doesn't need.

**Revisit when:** a salesman (or the owner, watching usage) actually asks "where did my cancelled order go?" — a real signal beats guessing.

## Username-only auth (synthetic email, drop the lookup) (flagged 2026-07-07)

**What:** replace D9's current "real email + server-side username→email lookup" with a **username-only** identity: the account's auth email becomes a synthetic `username@ganpati.local` (never a real inbox), so login rebuilds the email from the username directly — no DB lookup at all.

**Decision context (owner, 2026-07-07):** owner chose this direction in principle but explicitly deferred it — "not doing it anytime soon." It's genuinely simpler than what's shipped (D9): it deletes the `email_for_username` RPC, the `SUPABASE_SECRET_KEY` + `src/lib/supabase/service.ts` service client, the `server-only` dep, and the whole email-harvesting concern (flag ㉑) in one move — a good fit for a 3-person app where the admin already manages passwords manually (D3), so real reachable emails buy little in Phase 1. The reason it's parked, not done: (a) it reverses D9, which is currently built, reviewer-verified, and working; (b) it requires **recreating the existing auth users** with synthetic emails via the Dashboard (owner action — no MCP tool creates/edits auth users), which is disruptive to do just for a simplification nothing is currently blocked on.

**Scope when scheduled:** ① migration dropping `email_for_username` + its grant; ② rewrite `src/app/login/actions.ts` to build `username@<fixed-domain>` client-side (or in the action) instead of looking it up; ③ delete `service.ts`, the `SUPABASE_SECRET_KEY` env requirement, and `server-only`; ④ recreate the 3+ accounts with synthetic emails (owner, Dashboard); ⑤ rewrite D9 to record the reversal. Note the hard dependency: this only works because a **single fixed domain** is assumed — if real, reachable per-user emails are ever needed (email password-reset, notifications), stay on D9 instead.

**Revisit when:** the auth machinery actually causes friction (a secret-key rotation headache, a new dev tripping over the lookup), or a batch of new staff accounts is being created anyway so the recreation cost is already being paid.
