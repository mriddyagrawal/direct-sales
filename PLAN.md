# PLAN — Phased Roadmap

**Now:** M0 (design), the **M1 backend** (schema · RPCs · triggers · RLS · seed · provisioning — 11 migrations), the **M1 app + M3 auth** (Next.js app, `@supabase/ssr` auth, design system, S1 login + role-gated S2/S8 shells, production build green), and **M4 — the salesman order flow** (S3 → S7 + the write RPCs, on `feature/salesman-app`) are ✅ complete and reviewer-verified against the live Supabase project (Mumbai); see the Open Items Ledger in [comments.md](comments.md). The owner ran the live 90-second stopwatch test himself and it passed; the airplane-mode drill is deferred to a later manual pass (not blocking — idempotency and the offline-classifier path are already reviewer-proven by execution). **M5 — the accountant/admin dashboard** (Orders list + S9 workbench + S10 pick-slip + S11 retailers + Products pricing, `feature/accountant-dashboard`) is ✅ complete and reviewer-verified too — landing **all of Phase 1's app screens**. **Next: M6 — deploy + pilot** (Vercel prod, real accounts, onboarding). Decisions live in [docs/decisions.md](docs/decisions.md); specs in [docs/specs/](docs/specs/) are the source of truth. Work happens on **feature branches with granular commits**; every commit is reviewed by the REVIEWER in [comments.md](comments.md), and blocking findings are fixed in the very next commit.

---

## Phase 1 — Core MVP: digital order capture

**Goal:** kill the notebook. Salesman captures orders on his phone faster than paper; accountant sees them live, locks them, prints pick slips for the godown. (Honest scope: the accountant still types into Tally until Phase 2 — Phase 1 buys legibility, latency, and visibility.)

### Milestones

| # | Milestone | Exit criteria | Status · 2026-07-07 |
|---|---|---|---|
| ~~**M0**~~ | ~~**Design pass**~~ — a DESIGNER session reads this repo and authors `Prompts/phase1-design-prompt.md` per [design/design-brief.md](design/design-brief.md) (kickoff: `Prompts/designer-session-prompt.md`); **Claude design** then produces the Phase 1 screen designs from that self-contained file | Designs for the 11 screens approved by the owner; the completing commit records who approved and when | ✅ **Done** — approved by Mridul 2026-07-06 (`c82607e`) |
| ~~**M1**~~ | **Scaffold + schema** — Next.js app; Supabase dev project; migrations implementing [data-model](docs/specs/data-model.md), [lifecycle](docs/specs/order-lifecycle.md) RPCs/triggers, and the full [RLS matrix](docs/specs/roles-and-permissions.md) | REVIEWER passes all 6 items of the RLS verification protocol | ✅ **Done** — 11 migrations live & reviewer-verified (M1.1–M1.9); **RLS 6-step ✅**, RPC suite ✅, provisioning ✅. Next.js app scaffolded (App Router/TS, `@supabase/ssr`), production build green |
| **M2** | **Seed** — `scripts/seed.ts` per [seed-data.md](docs/specs/seed-data.md) | All post-seed verification queries pass; salesman client sees exactly 34 products | ✅ **Data done** — 42 products seeded, salesman sees 34, checks pass (M1.7). Drift-protected `scripts/seed.ts` loader deferred to app scaffold (ledger ⑬) |
| ~~**M3**~~ | **Auth + roles** — login flow, provisioning runbook executed for the real team | Each role logs in and sees only what the matrix allows | ✅ **Done** — S1 login (username→email via secret-key lookup, D9), middleware route-protection + role routing, deactivated-user lockout — all reviewer-verified live. Real-team account creation = a Dashboard runbook step at go-live |
| ~~**M4**~~ | **Salesman app** per [salesman-app.md](docs/specs/salesman-app.md) | All 6 acceptance criteria, incl. the 90-second stopwatch test and airplane-mode drills | ✅ **Done** — S3–S7 built (`feature/salesman-app`), all commits reviewer-accepted; idempotent submit, double-tap→one row, and the post-expiry server-side reject **proven live** by the REVIEWER against the real DB. Owner ran the 90s stopwatch test live — passed. Airplane-mode drill deferred (owner, later); not blocking. Two device bugs found in real phone testing fixed along the way: the sticky bottom-bar visibility, and `crypto.randomUUID()` throwing in the insecure (LAN-http) context |
| ~~**M5**~~ | **Accountant dashboard** per [accountant-dashboard.md](docs/specs/accountant-dashboard.md) | All 6 acceptance criteria, incl. live-appearance ≤5s and A4 pick-slip print | ✅ **Done** — Orders (S8 list + S9 workbench + S10 pick-slip) · Retailers (S11 verify queue) · Products (in-app pricing) as a 3-tab dashboard, desktop + phone; Realtime live-updates, post-lock edit-reason RPC (`p_reason`), TBD→salesman-visible — all reviewer-verified live. Owner deviations: phone version + in-app Products tab; users stay in Supabase ([add-user-runbook](docs/add-user-runbook.md)) |
| **M6** | **Deploy + pilot** — Vercel prod, Supabase prod, real accounts, onboard 1 salesman + accountant | Rollout gate below | ⬜ Not started |

> **Verified-complete detail** lives in the Open Items Ledger atop [comments.md](comments.md). No 🔴 blocking items open — see the ledger for the full non-blocking/deferred list.

### Open items — full mirror of the review ledger

No 🔴 blocking items. Everything below is non-blocking / deferred / owner-config. The REVIEWER's ledger atop [comments.md](comments.md) is the live source; mirrored here in full per owner request (2026-07-07).

| Flag | Item | Type | Home / next step |
|---|---|---|---|
| ㉗(b) | HISTORY renders real staff names, not a generic "the office" | owner-confirm | ✅ **Resolved 2026-07-07 (D10)** — owner confirms **real names**; current behavior stays, no change |
| ㉒ | `SUPABASE_SECRET_KEY` set in `.env.local` + Vercel env (D9 username→email lookup needs it, or login fails) | config / owner | ✅ **Resolved 2026-07-07** — owner set it. Still add it to **Vercel env** before deploy |
| ⑯ | Enable Supabase Auth leaked-password protection (HaveIBeenPwned check) | config / owner | Owner — **Pro-plan only**; enable at go-live (ties to Q#5/Q#7) |
| ㉛ | Least-privilege on `order_no_seq` — `anon`/`authenticated` hold default Supabase sequence grants (`USAGE`/`UPDATE`) they don't need. **Not exploitable** (no API path exposes `setval`/`nextval` — they're in `pg_catalog`, not the exposed schema; and `submit_order` is `security definer`, running the sequence as its owner). `revoke select, usage, update on sequence public.order_no_seq from anon, authenticated;` then confirm `submit_order` still assigns `order_no`. | hardening / deferred | **Owner: not required now** — do at go-live hardening (reviewer finding 2026-07-07) |
| ⑬ | Drift-protected `scripts/seed.ts` loader (warn/skip on price-drift re-run, `--force-prices` override) | minor / deferred | Buildable now (Node exists); do when a re-seed is first needed |
| ⑭ | RLS/index performance pass — 4 `get_advisors(performance)` categories (6 unindexed FKs incl. `orders.cancelled_by`, unwrapped `auth.uid()` in policies, multiple permissive policies, 1 unused index). Verified accurate + harmless at current scale | minor / deferred | Parked in [docs/future-plans.md](docs/future-plans.md); revisit with the Pro-billing decision |
| ⑦ | `sec-s6` render absent vs the "sec-s1…s8" range label in the design spec | minor / doc | Reconcile in a design-spec doc pass |
| ⑧ | Design spec cites a "future Payments tab — see docs/future-plans.md" entry that doesn't exist yet | minor / doc | Add the parking-lot entry or soften the reference |
| ⑨ | S1 body/renders still show the GE monogram that deviation #6 overrides with the receipt glyph (login **code** is correct; spec **text** unreconciled) | minor / doc | Reconcile spec text |

Closed flags (audit trail retained in [comments.md](comments.md)): ⑩ RLS fail-open · ⑪ `current_role` rename · ⑫ trigger `search_path` · ⑮ D8 self-cancel scope · ⑰ lint gate · ⑱ middleware cookie-drop · ⑲ font-var cycle · ⑳ S2 D8 filter · ㉑ username email-harvest · ㉓ offline misclassification · ㉔ zero-qty payload · ㉕ stale/deactivated catalog line · ㉖ silent pending-order discard · ㉗(a) overpromising offline copy.

### Rollout gate (adoption is the metric)

1. Pilot: one salesman, one route, **one week running app + notebook in parallel**.
2. Compare: capture time, error/dispute count, accountant effort.
3. The salesman chooses the app voluntarily → cut over; keep paper as fallback for one more week.
4. Before the pilot ends: upgrade Supabase prod to Pro (~$25/mo — the free tier pauses after ~1 week idle) and decide Vercel Pro ($20/mo; Hobby is non-commercial).

### In-phase choices (either is fine — builder decides at the milestone)

Realtime vs 30s polling for the dashboard · Tailwind vs vanilla CSS · PWA manifest for add-to-home-screen (cheap, do it at M4).

---

## Phase 2 — Tally integration: kill the re-typing

**Goal:** processed orders enter Tally without manual transcription. **This is a master-data mapping project first and a file-format project second.**

1. **Mapping sprint:** retailer ↔ Tally party-ledger names (the verification queue from Phase 1 already forces canonical spellings; fill `tally_ledger_name`), product ↔ stock-item names (`tally_name`), units, godown, and the inclusive-of-tax rate setting (D5).
2. **Voucher type decision (with the accountant):** recommended = import as **Sales Order** vouchers — matches the real flow (order → pick → deliver → bill) and leaves statutory invoicing inside Tally; alternative = direct Sales Invoice import.
3. **Path A (build):** dashboard exports selected processed orders as a Tally XML file; accountant imports via Gateway of Tally. Always tested against a **test company file** first.
4. **Idempotency:** exported orders are marked (`exported_at`); re-export warns; voucher narration carries `order_ref` for traceability both ways.
5. **Path C (only if A hurts):** a tiny local sync agent on the office PC pulls processed orders and POSTs XML to Tally's local HTTP port. At <20 orders/day, Path A's two clicks may be the permanent answer.
6. ~~Path B — browser pushes to `localhost:9000`~~ — dead end (CORS/Private Network Access/mixed content); see graveyard in [decisions.md](docs/decisions.md).

**Acceptance:** an order placed on a phone appears in the Tally test company with correct party, items, quantities, and inclusive rates — zero re-typing; re-export creates no duplicate vouchers.

---

## Phase 3 — Multi-brand

**Goal:** cover the other brands' visit rounds (D4 confirmed rounds are brand-separate). Mostly data, not code: new CSV in `data/` → seed with brand SKU prefix → brand picker at order start (a round is one brand) → dashboard/pick-slip brand context. **Architecture worked out in [docs/phase3-multi-brand-design.md](docs/phase3-multi-brand-design.md)** — the one real schema change is a first-class `orders.brand_id` (+ a submit brand-guard enforcing one-brand-per-order), and order refs gain a **brand code** (`ORD-ZEB-2026-1042`; global-sequence Option A recommended over per-brand Option B), revising D4's original brand-free ref.

**Acceptance:** two brands live; a salesman starts the right brand round in ≤1 tap; pick slips are unambiguous about brand.

---

## Phase 4 — Collections visibility (read-only)

**Goal:** the salesman sees a shop's outstanding before walking in — the credit cycle is half the business and today lives only in Tally.

- **Start:** accountant exports Tally's ledger-wise outstanding weekly → uploads CSV to the dashboard → app shows "Outstanding: ₹12,400 (as of Mon)" on the retailer picker and order screens.
- **Later:** the Phase 2 sync agent (if built) pushes balances automatically.
- **Scope guard:** strictly read-only. No payment recording in the app — money stays Tally's.

**Acceptance:** outstanding + as-of date visible at retailer pick time; a stale upload is visibly stale.

---

## Phase 5 — Controlled pricing & negotiation

**Goal:** let salesmen negotiate without breaking accounting. Predefined **discount tiers** (e.g. 2/5/10% buttons — no free-typing prices) + **approval workflow**: below-floor discounts flip the order to `pending_approval` (status headroom exists) for accountant/owner approval before processing. Every override lands in `order_events`.

**Acceptance:** arbitrary prices are impossible; the approval loop round-trips on real devices; the audit trail names who approved what.

---

## Unscheduled — [docs/future-plans.md](docs/future-plans.md)

Owner-approved ideas parked outside the committed phases (currently: **order-punch geotagging** — fail-open GPS fix at submit, order tags only, quiet presentation; **RLS/index performance pass** — 4 harmless-at-current-scale `get_advisors(performance)` findings from M1, revisit alongside the billing decision below or if real volume growth makes them matter; **"Cancelled orders" view for the salesman** — the un-hide screen for D8's default-hidden self-cancels, unscheduled until a real ask surfaces; **username-only auth** — swap D9's real-email-lookup login for synthetic `username@…` emails, simpler but reverses working code + needs account recreation, deferred by owner 2026-07-07).

## Open questions

| # | Question | Owner |
|---|---|---|
| 1 | Edit window: confirm the 2-hour default | Owner |
| 2 | Retailer master: seed from a Tally ledger export? (Best option — names then pre-match for Phase 2) | Owner + accountant |
| 3 | CSV provenance: do product names mirror Tally stock-item names? Decides when display-name typos get cleaned | Accountant |
| 4 | Pick slip: A4 laser or thermal printer? | Owner |
| 5 | Go-live billing: approve Supabase Pro ($25/mo) + Vercel Pro ($20/mo) | Owner |
| 6 | Godown phone view (read-only pick list) as Phase 1.5 if printing annoys | Later |
| 7 | Enable Supabase Auth's leaked-password protection (HaveIBeenPwned check) — Dashboard-only setting (Authentication → Providers → Email), no MCP tool exposes it; same class of limitation as creating auth users (ledger flag ⑯) | Owner |

## Changelog discipline

Decision changes hit [docs/decisions.md](docs/decisions.md) first; affected specs update in the same commit; milestone completion is claimed in the commit message and verified by the REVIEWER before it counts.
