# PLAN — Phased Roadmap

**Now:** planning complete → **design phase (Phase 1 · M0)** → build. Decisions live in [docs/decisions.md](docs/decisions.md); specs in [docs/specs/](docs/specs/) are the source of truth. Work happens on **feature branches with granular commits**; every commit is reviewed by the REVIEWER in [comments.md](comments.md), and blocking findings are fixed in the very next commit.

---

## Phase 1 — Core MVP: digital order capture

**Goal:** kill the notebook. Salesman captures orders on his phone faster than paper; accountant sees them live, locks them, prints pick slips for the godown. (Honest scope: the accountant still types into Tally until Phase 2 — Phase 1 buys legibility, latency, and visibility.)

### Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| **M0** | **Design pass** — a DESIGNER session reads this repo and authors `Prompts/phase1-design-prompt.md` per [design/design-brief.md](design/design-brief.md) (kickoff: `Prompts/designer-session-prompt.md`); **Claude design** then produces the Phase 1 screen designs from that self-contained file | Designs for the 11 screens approved by the owner; the completing commit records who approved and when |
| **M1** | **Scaffold + schema** — Next.js app; Supabase dev project; migrations implementing [data-model](docs/specs/data-model.md), [lifecycle](docs/specs/order-lifecycle.md) RPCs/triggers, and the full [RLS matrix](docs/specs/roles-and-permissions.md) | REVIEWER passes all 6 items of the RLS verification protocol |
| **M2** | **Seed** — `scripts/seed.ts` per [seed-data.md](docs/specs/seed-data.md) | All post-seed verification queries pass; salesman client sees exactly 34 products |
| **M3** | **Auth + roles** — login flow, provisioning runbook executed for the real team | Each role logs in and sees only what the matrix allows |
| **M4** | **Salesman app** per [salesman-app.md](docs/specs/salesman-app.md) | All 6 acceptance criteria, incl. the 90-second stopwatch test and airplane-mode drills |
| **M5** | **Accountant dashboard** per [accountant-dashboard.md](docs/specs/accountant-dashboard.md) | All 6 acceptance criteria, incl. live-appearance ≤5s and A4 pick-slip print |
| **M6** | **Deploy + pilot** — Vercel prod, Supabase prod, real accounts, onboard 1 salesman + accountant | Rollout gate below |

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

**Goal:** cover the other brands' visit rounds (D4 confirmed rounds are brand-separate). Mostly data, not code: new CSV in `data/` → seed with brand SKU prefix → brand picker at order start (a round is one brand) → dashboard/pick-slip brand context. Order refs stay brand-free.

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

Owner-approved ideas parked outside the committed phases (currently: **order-punch geotagging** — fail-open GPS fix at submit, order tags only, quiet presentation; **RLS/index performance pass** — 4 harmless-at-current-scale `get_advisors(performance)` findings from M1, revisit alongside the billing decision below or if real volume growth makes them matter; **"Cancelled orders" view for the salesman** — the un-hide screen for D8's default-hidden self-cancels, unscheduled until a real ask surfaces).

## Open questions

| # | Question | Owner |
|---|---|---|
| 1 | Edit window: confirm the 2-hour default | Owner |
| 2 | Retailer master: seed from a Tally ledger export? (Best option — names then pre-match for Phase 2) | Owner + accountant |
| 3 | CSV provenance: do product names mirror Tally stock-item names? Decides when display-name typos get cleaned | Accountant |
| 4 | Pick slip: A4 laser or thermal printer? | Owner |
| 5 | Go-live billing: approve Supabase Pro ($25/mo) + Vercel Pro ($20/mo) | Owner |
| 6 | Godown phone view (read-only pick list) as Phase 1.5 if printing annoys | Later |

## Changelog discipline

Decision changes hit [docs/decisions.md](docs/decisions.md) first; affected specs update in the same commit; milestone completion is claimed in the commit message and verified by the REVIEWER before it counts.
