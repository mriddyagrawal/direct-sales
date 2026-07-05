# Review log — Ganpati Enterprises Direct Sales

**Role split:** The BUILDER writes code and commits. The REVIEWER (me, a separate Claude session) reviews every commit, verifies it by actually running things, and appends one review block per commit below. The BUILDER reads these comments and addresses them in the next commit. Blocking issues must be fixed in the *very next* commit — no piling new functionality on top of a known-broken base.

## How this log works (the method, distilled from ~/Documents/GitHub/morenseprofits/comments.md — 252 reviews)

1. **One block per BUILDER commit, appended at the bottom, in commit order.** Heading format: `## Review of <short-sha> — <commit subject>`.
2. **Every review is verified by execution, not by reading alone.** I run the app, run the tests, poke the database, exercise the exact flow the commit claims to deliver. The "What I tried" section lists the literal commands/steps so anyone can reproduce my verdict.
3. **Verdicts:**
   - ✅ **accept** — commit does what it says; no blockers.
   - ⚠️ **accept-with-followups** — works, but has flags that must be carried into a near-term commit.
   - ❌ **reject** — the very next commit must fix this before anything else lands.
4. **Blocking vs non-blocking is explicit.** Blocking = correctness, data-loss, security (RLS leaks), money-math, or state-machine violations. Non-blocking = style, perf, future-proofing. Non-blocking flags that slip past a phase boundary get logged in "Open flags (cumulative)" so they never silently die.
5. **After writing a review block, I commit it myself:** `review(<short-sha>): <verdict> — <one-line summary>` touching only this file. The BUILDER never edits my blocks; I never edit BUILDER code.
6. **Commit-message hygiene is reviewed too.** If the message claims "returns 42 rows" and it returns 61, that gets flagged — future readers must be able to trust the log.

### Per-review template

```
## Review of <sha> — <subject>

**Verdict:** ✅ / ⚠️ / ❌

**Phase / commit goal (as I understood it):** <one paragraph>

**What works:** <verified bullets, with file:line links>

**Blocking issues (must fix in next commit):** <or "None">

**Non-blocking suggestions:** <bullets>

**Domain / correctness checks:** <the standing checklist below, item by item where applicable>

**What I tried:** <literal commands, queries, UI flows exercised>

**Open flags (cumulative):** <carry-over list from prior reviews, closed items marked ✅ CLOSED>

**Next-commit suggestion:** <smallest most valuable next step>
```

### Standing domain checklist (this project's equivalent of "options math / look-ahead bias")

Checked in every review where the commit touches the relevant surface:

- **Order state machine:** DRAFT → SUBMITTED (2h editable) → LOCKED transitions enforced **server-side** (Postgres/RLS or API), never trust the client clock or client state. The 2-hour window must be computed against `submitted_at` in the DB, timezone-safe (IST operations, UTC storage).
- **Gapless sequence:** order numbers come from a Postgres `SEQUENCE`/serialized transaction — no UUIDs shown to humans, no race window between two simultaneous submits, no gaps introduced by rollbacks the design didn't account for.
- **Immutable snapshots:** `order_items` copies `product_name` + `price` at SUBMIT time. A price-list update must never mutate any historical order. Verified by changing a price and re-reading an old order.
- **RLS / auth:** a salesman can only read/write *their own* orders; the accountant role sees all. Verified with two distinct authenticated clients, not by reading policy SQL alone.
- **Money math:** prices stored as integer paise or `numeric`, never floats; totals recomputed server-side, client total is display-only.
- **Locking:** once LOCKED, salesman writes are rejected at the DB/API layer (not just hidden in the UI).
- **Catalog integrity:** SKUs, categories, and prices in the app match ZebronicsPriceList.csv (the source of truth); flag drift.
- **Mobile-first Quick Order:** stepper flow works one-handed, sticky cart total is correct, search filters live — checked in a real browser/viewport, not by reading JSX.
- **Tally export (Phase 2+):** XML validates against Tally's import schema; only LOCKED orders export; re-export is idempotent (no duplicate vouchers).

### Watcher / cadence mechanics

Two triggers wake the REVIEWER:
1. **Commit watcher** — a background poller on this repo's git HEAD; fires within ~30s of any new commit.
2. **15-minute sweep** — a recurring 15m loop that catches anything the poller missed and re-arms it after each review cycle.

On every wake: `git log` since the last reviewed sha → review each new commit oldest-first (one block each) → commit this file → re-arm the watcher. If there is nothing new: no block is written, no noise committed.

---
