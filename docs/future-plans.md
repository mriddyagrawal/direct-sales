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

## Payments tab — reserved bottom-bar slot (2026-07-06)

**What:** a possible future third destination in the salesman bottom tab bar (and its dashboard counterpart) for payment/collection data against a retailer.

**Decision context:** the bottom tab bar (design-spec deviation #1) is **Home + New Order only** for Phase 1, but its slot grammar **deliberately reserves room for a Payments tab** so adding one later doesn't reshuffle the bar. Nothing is built or speced — this entry exists so the design spec's forward-reference ("the future Payments tab — see docs/future-plans.md") resolves to something. Note the scope guard: **money stays in Tally.** Phase 4 (collections) is strictly *read-only outstanding visibility* with no payment *recording* in the app — so a real Payments tab would first need an owner decision on whether the app ever records payments at all, which today it does not.

**Revisit when:** the owner decides the app should surface or record payment/collection data beyond Phase 4's read-only outstanding view.

## Fulfillment & serial/QR capture at dispatch — new godown role (owner-approved 2026-07-07 · Phase 4+, structure TBD)

**What:** capture the **serial / QR of each physical unit** as it's dispatched from the godown, tied to the order + party — an exact record of which units went where. **Mandatory for LG** (white goods are serial-tracked for warranty + LG's own distributor/warranty reporting); a **good-to-have tracking add for other brands** (Zebronics etc.).

**Who captures — the GODOWN/WAREHOUSE staff, NOT the salesman (owner correction 2026-07-07).** The field salesman never touches the warehouse. So this needs a **new `warehouse`/`godown` role** (added later) with its own fulfillment screen. (Corrects the earlier "salesman scans" sketch.)

**The cycle (owner's description):** order placed → (for LG, **admin-approved** — the Phase-3b gate) → the order surfaces to the godown as a **fulfillment/dispatch queue** → godown staff pick the units and **scan / enter each unit's serial** into the app → **the accountant takes those serials and enters them into Tally, where the bill/invoice is created** → the printed bill + goods go out to the party. So — for **any** brand, **the Tally bill is created at *dispatch* (once the items are physically out), driven off the captured serials — not at order-time.** (This refines [phase2-tally-sync-design.md](phase2-tally-sync-design.md)'s app→Tally trigger; **exact structure is undecided — decide properly when scheduled.**)

**App = capture tool, not the final ledger:** serials flow onward — into **Tally** (initially via the accountant re-keying; a direct sync is a later optimization) and almost certainly into **LG's own distributor/warranty portal** (verify LG's required format — that's the real spec the LG capture must satisfy). Tally stays the accounting system of record; the app is the fast mobile capture surface that kills paper transcription.

**Shape when built (all TBD):**
- **New role** `warehouse`/`godown` + RLS + a fulfillment screen (queue of dispatchable orders; per-line serial entry).
- **`order_item_serials`** table (per *unit*: `serial`, `order_item_id`, `captured_by`, `captured_at`, optional photo) — qty 3 ⇒ 3 serials. Additive.
- **Capture UX:** barcode **scan** primary (LG serials are barcoded), **manual type** fallback, **photo** audit-only (OCR unreliable). Feasibility: `BarcodeDetector` works on **Android Chrome**, **not iOS Safari** (needs a JS decoder lib there) — a native app scans best but is out of the web stack.
- **New order state** for "dispatched/fulfilled" (closes the loop; could carry the parked order-submit **geotag** as proof-of-delivery — see that entry).
- **LG = required** (app-scan, or paper serials brought back as the fallback); **other brands = optional** tracking.

**Don't over-build:** at <20 orders/day with LG a subset, volume is tiny — **manual serial entry alone is fine**; the scan is a speed-up, not a blocker. MVP = fulfillment queue + per-line serial entry (scan or type) + submit + a clean export for LG/accountant.

**Depends on / revisit when:** **Phase 2 (Tally sync)** and **Phase 3b (LG)** are live — it rides on both. May graduate from this parking lot into a dedicated PLAN phase + design doc once the structure (roles, Tally trigger, LG-portal integration) is decided.
