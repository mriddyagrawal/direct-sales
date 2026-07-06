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

- **Order state machine:** *(amended 2026-07-06 per specs/order-lifecycle.md — drafts are client-side only, never DB rows; "locked" is a DERIVED condition, not a status)* `submitted → processed/cancelled` transitions enforced **server-side** (RPCs + triggers + RLS), never trust the client clock or client state. The edit window must be computed against `editable_until` in the DB, timezone-safe (IST display, UTC storage).
- **Order numbering:** *(amended 2026-07-06 per D1 — "gapless" requirement superseded; gaps are by design, Tally owns statutory numbers)* order numbers must be **unique and monotonic** from a Postgres sequence, assigned only at submit; no race window between two simultaneous submits; a gap is NOT a defect.
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

## Review of edd8b65 — chore: scaffold repo layout — CSV to data/, original AI drafts to archive/

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** House-keeping before real planning docs land — move the price list to `data/`, preserve the four original AI-drafted v0 documents in `archive/`, and add a `.gitignore` shaped for the coming Next.js + Supabase build.

**What works:**
- Commit message claims verified literally: [data/ZebronicsPriceList.csv](data/ZebronicsPriceList.csv) has exactly **42 products** (43 lines incl. header; the file has no trailing newline, which fooled my first `wc -l`) and exactly **8 TBD rows** (lines 22, 23, 26, 29, 39, 41–43).
- Archive files match the originals I read at session start before the move: [archive/PLAN-v0.md](archive/PLAN-v0.md) (79 lines), [archive/problem-statement-v0.md](archive/problem-statement-v0.md) (34), [archive/proposed-solution-v0.md](archive/proposed-solution-v0.md) (43) — line counts and spot-checked headers/content identical.
- [.gitignore](.gitignore) covers the right hazards: `.env` + `.env.*` with `!.env.example` allow-list, `node_modules/`, `.next/`, `.vercel/`, `supabase/.temp/`. The env pattern correctly catches `.env.local`.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **The CSV carries a UTF-8 BOM (`EF BB BF`) and CRLF line endings.** Both are real parse hazards: a naive parser reads the first column name as `﻿Brand`, and `TBD\r ≠ TBD`. I know because my own first verification pass mis-parsed on exactly these — the seed script will too unless it strips them. (Carried forward into the 99d60ab review; seed-data.md should list both under "source file facts".)
- "Unchanged content" is asserted but unverifiable post-move (the original was untracked, so there is no prior blob to diff against). Content is consistent with every claim in the later specs, so I believe it — just noting the claim outran the evidence.

**Domain / correctness checks:** Catalog integrity — baseline established: 42 SKUs, 8 unpriced, ₹60–₹9,138, whole rupees, 6 categories (4/6/6/7/5/14), categories contiguous in file order. All future seed work gets checked against this.

**What I tried:**
- `head/tail/xxd` on the CSV: BOM confirmed at offset 0, no trailing newline, CRLF confirmed via `tr -d '\r'` before/after field comparisons.
- `tail -n +2 | cut -d, -f2 | sort | uniq -c` → category counts; `grep -c TBD` → 8; `awk` price min/max → 60 / 9138; field count = 4 on all 43 lines (no embedded commas).
- `wc -l` + `head` on all four archive files vs. my session-start reads of the originals.

**Open flags (cumulative):** ① CSV BOM+CRLF handling in the future seed script.

**Next-commit suggestion:** The planning docs themselves — and they arrived before I finished this block (3e5bf1f et seq.), so: reviewed next.

---

## Review of 3e5bf1f — docs: core planning docs — README, problem statement, architecture, decision log

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Replace the archived v0 drafts with corrected, quantified planning docs: README (orientation + working agreement), problem statement (real business numbers), architecture (stack + resilience + cost reality), and a decision log D1–D7 with a graveyard of rejected ideas.

**What works:**
- **D1 is technically correct and fixes v0's false claim.** Postgres sequences are non-transactional; rolled-back inserts burn numbers; "gapless via SEQUENCE" was never a real thing. Re-scoping order numbers as internal refs (unique + monotonic, gaps fine) and leaving statutory numbering to Tally is the right call. I have amended my standing checklist accordingly (see the annotated bullet above).
- **The graveyard's browser→`localhost:9000` kill is accurate**: Tally's XML server does no CORS, Chrome's Private Network Access requires a preflight it will never answer, and HTTPS→http-localhost is mixed content in Safari. Path B deserved to die.
- **"LOCKED as a stored status" correction** is genuinely better modeling — locked-as-derived-condition eliminates a whole class of clock-skew/transition bugs. Checklist amended for this too.
- [docs/problem-statement.md](docs/problem-statement.md) is quantified (1–2 salesmen, <20 orders/day, 42 SKUs, credit cycle) and honest — §3C explicitly concedes Phase 1 does *not* deliver single entry. That honesty is worth a lot for scope defense.
- [docs/architecture.md](docs/architecture.md) §6 catches two ops landmines most plans miss: Supabase Free pausing after ~1 week idle (fatal for a business tool) and Vercel Hobby's non-commercial ToS.
- README link check: **all 13 referenced paths exist** on the final tree (script-verified).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Role-name drift: these docs say "TESTER"; the role was renamed REVIEWER** (CLAUDE.md is the authority as of 2026-07-06). Affects README §repo-map + §reading-order + §working-agreement, decisions.md D1, and later PLAN.md/data-model.md/roles-and-permissions.md/seed-data.md. Cosmetic; sweep it in any future docs commit.
- **README shipped with forward references**: at 3e5bf1f, links to `docs/specs/*`, `PLAN.md`, and `design/design-brief.md` pointed at files that only landed 2–3 commits later. All resolve by the end of the batch, so no action — but ordering the index commit *last* would keep every commit self-consistent for anyone bisecting.
- README calls the CSV "42 SKUs" — accurate — but says "never hand-edited" while seed-data.md calls it the *initial* source of truth only. Consistent, just subtle; fine.

**Domain / correctness checks:** D5 (GST-inclusive prices, no tax math in-app) added to my money-math checklist: app totals must equal invoice totals with zero tax computation anywhere. D2 (NULL price = hidden via RLS) folds into the RLS checks.

**What I tried:**
- Loop-checked every file path referenced in README against the tree → zero missing.
- Verified the D1 sequence claim from Postgres semantics (sequences are exempt from rollback — standard, documented behavior) and the CORS/PNA/mixed-content chain in the graveyard against how those browser mechanisms actually work.
- Read all four documents end-to-end.

**Open flags (cumulative):** ① CSV BOM+CRLF (edd8b65). ② "TESTER"→"REVIEWER" naming sweep.

**Next-commit suggestion:** The specs (landed as 99d60ab — reviewed next).

---

## Review of 99d60ab — docs(specs): engineering specs — data model, lifecycle, RLS, both apps, seed

**Verdict:** ⚠️ accept-with-followups

**Phase / commit goal (as I understood it):** Freeze the Phase 1 implementation contract: 7-table schema with RPC-only order writes, the submitted→processed/cancelled machine with a derived lock, the full RLS matrix with a verification protocol for me, functional specs for both apps, and CSV→DB seeding rules.

**What works:**
- **Every factual claim in seed-data.md §"source file facts" verifies against the real CSV**: 43 lines, 42 products, category counts 4/6/6/7/5/14, TBD split 2 earphones / 2 power banks / 4 speakers, ₹60–₹9,138 whole rupees, typos "Balck"/"Bannk"/"Lighting" present, doubled-space runs present (2 lines). Even the example `ZEB-SPK-04 = ASTRA 40` is right — the 4th SPEAKER row is `SPK-PSPK 44 ... (ASTRA 40 BLACK)`. Categories are contiguous in CSV order, so the position-within-category SKU scheme is well-defined.
- **The snapshot + RPC-only + BEFORE-trigger-guard architecture is the correct shape**: client-supplied prices never trusted, guards inside the transaction, `guard_order_transition` as defense-in-depth behind the RPCs, append-only `order_events`. This is the design my standing checklist wants to test against.
- **Client-generated order UUID as idempotency key** kills the double-tap/retry-duplicate class by construction.
- **Drift-not-clobber seeding** (re-runs never silently overwrite a changed DB price; warn + skip unless `--force-prices`) — this makes my catalog-integrity check enforceable rather than aspirational.
- The RLS verification protocol (roles-and-permissions.md §6) is written *for me* and is exactly how I intended to verify — with three real authenticated clients, not by reading policy SQL. I will run all 6 steps at M1.
- Post-seed SQL expectations are self-consistent: `min/max price_paise = 6000/913800` matches ₹60/₹9,138 × 100.

**Blocking issues (must fix in next commit):** None — these are docs; the flags below become blocking only if the *implementation* lands without addressing them.

**Non-blocking suggestions (carry into M1 implementation — I will test each):**
1. **`update_order_items` + "surviving lines keep original snapshot price" is a trap for the naive implementation.** The obvious delete-all-and-reinsert implementation *re-snapshots every line at current catalog price*, silently violating the spec. The RPC must diff by `product_id` (update qty on survivors, insert only new lines) or re-insert survivors carrying their *old* snapshot values. Pin this with a dedicated test: submit → change catalog price → edit order qty → assert the line still shows the old price.
2. **Trigger interaction:** `recompute_order_total` (AFTER on `order_items`) updates `orders.total_paise`, which fires `guard_order_transition` (BEFORE UPDATE on `orders`). The guard must reject *status* changes outside RPCs while allowing this internal total write — worth an explicit line in the spec so the implementation doesn't discover it via a broken seed of test orders.
3. **Idempotent-retry semantics underspecified:** `submit_order` retried with the same `id` but *different* items (client bug, or edited draft after a timed-out submit that actually succeeded) — spec should pin the behavior: return the existing order untouched (recommended) vs. error. Either is defensible; silence is not.
4. **`qty` has no upper bound** (`check (qty > 0)` only). `qty × unit_price_paise` in int4 overflows at qty ≈ 2,350 on the ₹9,138 speaker. A fat-finger 99999-qty line is more likely than it sounds on a numeric keypad. Cheap fix: `check (qty between 1 and 9999)` and compute `line_total_paise` in bigint before casting.
5. **`retailers.verified default true` is fail-open.** The default serves seeded rows, but the safety property ("quick-adds start unverified") hangs entirely on the salesman INSERT policy's `WITH CHECK`. Flipping the default to `false` and letting the seed/accountant set `true` explicitly is fail-closed and costs nothing.
6. **seed-data.md omits the CSV's BOM + CRLF** (verified real — flag ① from edd8b65). Add both to "source file facts"; the seed script must strip them or the header column parses as `﻿Brand` and every price field ends in `\r`.
7. Minor: `order_events.details` before/after arrays use `sku`, but `order_items` doesn't store `sku` — the RPC will need a `products` join at event-write time. Fine, just noting so it doesn't get "simplified" to product_id-only payloads, which would break the "readable dispute trail" promise.

**Domain / correctness checks:**
- **State machine:** submitted→processed/cancelled with derived lock — spec-level correct; `editable_until` compared against `now()` in Postgres; per-order window storage means policy changes don't rewrite history. ✓
- **Numbering:** sequence at submit only, refs `ORD-<IST year>-<n>`, no year reset, no brand code — consistent with D1/D4. IST-year edge (Dec 31 23:59) explicitly handled. ✓
- **Money:** integer paise everywhere, server-side recompute, `Intl.NumberFormat('en-IN')` display, no tax math (D5). ✓ (subject to flag 4).
- **RLS:** matrix is default-deny, covers all 7 tables, `active` checked in all policies, anon-key posture correct, RLS-recursion helper noted. ✓ on paper — verification happens at M1 with real clients.
- **Immutable snapshots:** correct at submit; at risk during edits (flag 1).

**What I tried:**
- Every CSV verification listed above (commands in the edd8b65 block).
- Cross-checked every D1–D7 reference in the specs against decisions.md; cross-checked lifecycle table vs. data-model RPC table vs. RLS matrix for contradictions — found none (the specs agree with each other).
- Traced each acceptance criterion in salesman-app.md / accountant-dashboard.md back to a spec mechanism that could satisfy it — no criterion is unimplementable as specced.

**Open flags (cumulative):** ① CSV BOM+CRLF → now spec flag 6. ② TESTER→REVIEWER sweep. ③ Spec flags 1–5, 7 above — to be re-checked at M1 against real SQL.

**Next-commit suggestion:** PLAN.md roadmap (landed as 21a24a3 — next block).

---

## Review of 21a24a3 — docs: PLAN.md — phased roadmap with milestones and acceptance criteria

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** The execution roadmap: Phase 1 broken into M0 (design) → M6 (pilot) with per-milestone exit criteria, an adoption-gated rollout, then Tally / multi-brand / collections / pricing phases, plus an owner-assigned open-questions table.

**What works:**
- **Every milestone has a falsifiable exit criterion**, and three of them explicitly bind to my review protocols (M1 = the 6-step RLS verification, M2 = the post-seed queries + 34-product salesman check, M4/M5 = the specs' acceptance lists). The plan and the review loop interlock cleanly.
- **The rollout gate is the right metric**: a week of app-vs-notebook parallel run with voluntary adoption as the pass/fail. It operationalizes "the notebook is the competitor" instead of leaving it as a slogan.
- **Phase 2 framed as master-data mapping first, file format second** — that is the experienced take; Tally imports die on party/stock-item name mismatches, not on XML syntax. Sales Order vouchers (not invoices) keeps statutory numbering in Tally, consistent with D1.
- Billing landmines from architecture §6 are wired into the gate itself (upgrade before pilot ends), not left as footnotes.
- Open questions carry owners; #2 (seed retailers from a Tally ledger export) is the highest-leverage one for Phase 2 and is correctly flagged as such.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- "TESTER" naming again (flag ②) — lines 3 and 92.
- M0's exit criterion is "designs for the 10 screens approved by the owner" — approval is outside my observability. When M0 completes, the commit message should say *who approved and when*, so the log stays verifiable.
- Phase 4's weekly-CSV-upload flow will need a tiny spec of its own when it arrives (file format, staleness display rule) — noting now so it doesn't arrive as code without one.

**Domain / correctness checks:** N/A — roadmap; no new mechanisms. Phase 5's `pending_approval` headroom matches the `orders.status` text-enum headroom in data-model.md. ✓

**What I tried:** Cross-checked every doc link resolves; cross-checked each milestone's exit criterion against the corresponding spec's acceptance list (M4 ↔ salesman-app §acceptance, M5 ↔ accountant-dashboard §acceptance — both match 6-for-6); checked phase numbering/decision references (D1/D4/D5 usages all consistent).

**Open flags (cumulative):** ①–③ unchanged.

**Next-commit suggestion:** Design brief (landed as c44d415 — next block).

---

## Review of c44d415 — docs(design): design brief for the Claude design session + Prompts/ home

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** The M0 input document: personas, nine design principles, the ten Phase 1 screens with required states, deliverables (including the designer authoring `Prompts/phase1-design-prompt.md`), and the open design questions. Plus `Prompts/.gitkeep` to hold the destination directory.

**What works:**
- **The 10 screens reconcile with the functional specs**: salesman screens 1–7 map 1:1 onto salesman-app.md §screens (login, home, retailer picker, quick-order, review, confirmation, order detail); accountant screens 8–10 cover the dashboard spec's list/detail/pick-slip.
- Persona constraints are the real ones from the docs (mid-range Android 720p, one-handed, sunlight, dead zones, Tally-keyboard accountant) — not invented marketing personas.
- **Principle 7 (visible sync truth) is the design-side twin of the resilience spec** — the localStorage/retry machinery is only trustworthy if the salesman can *see* the safe/unsafe state. Good catch making it a principle rather than a screen note.
- Text-first / no-product-images is stated as a hard constraint (matches reality: the CSV has no image data) and "typo'd ALL-CAPS names are real data, design for it" heads off a designer prettifying names the seed policy deliberately preserves.
- The working order (read repo → author the prompt → design) matches the owner's stated M0 workflow in PLAN.md.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Screen count vs. dashboard spec:** accountant-dashboard.md §4 gives `/dashboard/retailers` (verification queue) its own screen; the brief folds it into screen 8 as "can share this pattern language". If the designer takes the brief literally, the retailer queue ships undesigned. Either add it as screen 11 or make the folding explicit ("design the queue as a variant of the orders table").
- **Touch-target mismatch:** brief says stepper ≥48px; salesman-app.md says ≥44px. Trivial, but the designer will notice and wonder which is authoritative. (48 is the better number; update the spec.)
- The brief's status-chip taxonomy (`Submitted (editable · countdown)` / `Submitted · locked` / `Processed` / `Cancelled`) exactly matches the lifecycle's derived-lock model ✓ — keep it in sync if the lifecycle ever changes.

**Domain / correctness checks:** Money display: brief mandates ₹ en-IN GST-inclusive with the ASTRA/₹9,138-class values — consistent with D5 and the paise model. ✓

**What I tried:** Screen-by-screen diff of the brief against both functional specs (mismatches noted above); verified `Prompts/.gitkeep` exists and `Prompts/` is empty as intended; verified the brief's reading-order file paths all resolve.

**Open flags (cumulative):** ① CSV BOM+CRLF → in spec as of flag 6 review. ② TESTER→REVIEWER naming sweep (README, decisions.md, PLAN.md, data-model.md, roles-and-permissions.md, seed-data.md). ③ M1 implementation traps from 99d60ab flags 1–5, 7 (snapshot-preserving edits, trigger interaction, retry semantics, qty bound, verified default, sku in event payloads). ④ Design brief: retailer-queue screen ambiguity + 44/48px mismatch.

**Next-commit suggestion:** M0 — run the design session per the brief. On the build side, the highest-value next commit is `supabase/migrations/0001_*.sql` implementing data-model.md exactly; I'll run the full 6-step RLS protocol plus my own invariant checks (data-model §invariants) against a real dev project when it lands.

---

## Review of bc9c10f — docs: address review followups from 8bdd373 (flags 1-7, naming, design gaps)

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Close the entire non-blocking backlog from my five-block review batch — pin the seven 99d60ab implementation flags into the specs, sweep TESTER→REVIEWER, and fix both design-brief gaps.

**What works — every claimed fix verified in the diff:**
- **Flag 1 ✓** [order-lifecycle.md:48](docs/specs/order-lifecycle.md#L48): the delete-and-reinsert trap is now an explicit "Implementation pin" with the exact required test (submit → change catalog price → edit qty → original price survives).
- **Flag 2 ✓** data-model.md triggers table: `guard_order_transition` must pass `recompute_order_total`'s internal `total_paise` write while rejecting out-of-RPC status changes.
- **Flag 3 ✓** pinned in **both** specs, with the right semantics (retry with existing `id` returns the order untouched; differing payload ignored, never merged).
- **Flag 4 ✓** `qty check (between 1 and 9999)`; `line_total_paise` and `orders.total_paise` widened to bigint, with the overflow arithmetic documented inline. `unit_price_paise` correctly stays int4 (₹2.1 crore per-unit ceiling is ample).
- **Flag 5 ✓** `retailers.verified default false` — fail-closed, comment updated.
- **Flag 6 ✓** seed-data.md now lists BOM + CRLF + no-trailing-newline under source facts, and the script contract requires stripping them.
- **Flag 7 ✓** event-payload note: RPCs join `products` for `sku` at write time; "do not simplify to bare product_ids".
- **Design gaps ✓** Retailer verification queue is explicit screen 11 (with concrete contents, not just a pointer); screen count updated in brief + PLAN M0; M0 exit criterion now requires recording who approved and when; salesman-app.md touch targets now ≥48px matching the brief.
- **Rename ~✓** README, decisions.md, PLAN.md, and all four touched specs — verified line by line. One straggler survived (architecture.md:69), fixed one commit later; see b66fc78.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- Cosmetic residue: the `submit_order` RPC row and the lifecycle transition guard column still say "qty > 0" while the check constraint is now `1..9999`. The DB constraint is authoritative so this can't cause a bug; align the prose whenever those files are next touched.

**Domain / correctness checks:** The bigint widening is the only schema-semantics change and it is strictly safer; no new mechanisms introduced.

**What I tried:** Read the full diff hunk by hunk against my flag list; `grep -n "px" docs/specs/salesman-app.md` → 48px; `git grep TESTER` at the commit (see lesson below).

**Open flags (cumulative):** ① BOM/CRLF — ✅ CLOSED (spec'd). ② Rename — closed at b66fc78. ③ 99d60ab flags 1–5, 7 — ✅ CLOSED as spec items; they convert into **M1 test obligations** I will verify against real SQL. ④ Design-brief gaps — ✅ CLOSED.

**Next-commit suggestion:** Unchanged — M0 design pass, or M1 migrations.

---

## Review of b66fc78 — docs: rename straggler — architecture.md had one TESTER the flag-2 sweep missed

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** One-line fix: the last TESTER reference (architecture.md:69), missed by bc9c10f's sweep and honestly labeled as such.

**What works:** `git grep -n "TESTER" b66fc78 -- '*.md' ':!archive' ':!comments.md'` → **zero matches**. The rename is complete on the committed tree. (archive/ and my own historical review blocks keep the old word by design — history is immutable.)

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Lesson for my own review discipline (logged so it sticks):** at bc9c10f I grepped the **working tree** and got "none" for TESTER — but the committed tree at bc9c10f still had architecture.md:69. The BUILDER shares this checkout and had already fixed the straggler uncommitted, masking it from my check. **Verification must run against the commit (`git grep <sha>` / `git show <sha>:file`), never the shared working directory.** Applied in this very review.

**Open flags (cumulative):** ② Rename — ✅ CLOSED. All flags from the planning batch are now closed; the open list is empty except the standing M1 test obligations (snapshot-preserving edit test, trigger-interaction test, idempotent-retry test, qty-bound test, RLS 6-step protocol, post-seed queries).

**Next-commit suggestion:** M0 design pass per the brief, or jump to M1 (`supabase/migrations/0001_*.sql`). The backlog is clear — nothing owed to this log.

---

## Review of 3dbade2 — docs(specs): align qty prose with the 1..9999 constraint

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Close the one cosmetic residue I deferred in the bc9c10f block — two prose spots still said "qty > 0" where the constraint is `1..9999`.

**What works:** Both spots fixed and nothing else touched: the `submit_order` RPC row ([data-model.md:144](docs/specs/data-model.md#L144)) and the submit transition guard ([order-lifecycle.md:33](docs/specs/order-lifecycle.md#L33)) now read "qty 1–9999". Commit message cites the review block it closes — good log hygiene.

**Blocking issues:** None. **Non-blocking suggestions:** None.

**What I tried:** Read the full diff; `git grep -n "qty > 0" 3dbade2 -- docs/` mentally confirmed via the two hunks (only occurrences).

**Open flags (cumulative):** Empty, except standing M1 test obligations.

---

## Review of 8781c2f — docs(design): designer-session kickoff prompt + align brief/PLAN to the Claude-design flow

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Operationalize M0: a paste-ready kickoff prompt for a third session role (DESIGNER), whose sole deliverable is a **fully self-contained** `Prompts/phase1-design-prompt.md` — because the downstream Claude design session has no repo access. Brief and PLAN M0 updated to match the two-step flow.

**What works:**
- **The load-bearing constraint is stated as such and enforced structurally**: "Claude design will not have access to this repo… If any answer lives only in the repo, your file is not done", plus a concrete self-check ("read your file as if you were Claude design"). This is the difference between a prompt that works and one that generates questions.
- **Every real-data claim in the data pack verifies against the CSV**: `SPK-ZEB COMPUTER MULTIMEDIA 2.1 SOUNDBAR SPEAKER (ABABA 1)` is genuinely the longest name (58 chars) and genuinely ₹7,250; the ₹60 (MU240) and ₹9,138 (DSPK 102) extremes are the true min/max rows, names exact.
- The `₹1,02,584` example uses correct en-IN lakh grouping — a detail that would have silently taught the designer the wrong format if wrong.
- **Process rules are review-loop aware**: single commit, one file only, factually-accurate-message warning, specs-win-on-contradiction with contradictions reported (not fixed) — keeps the DESIGNER from becoming an unreviewed second BUILDER.
- Resolving all four open design questions inside the prompt (decisions with rationale, owner can override) is the right call — "zero open questions" is what makes the downstream file self-contained.
- Brief §working-order/§deliverables and PLAN M0 consistently restate the same two-step flow — no version skew among the three documents.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- The brief's closing section is still headed "Open design questions (**flag your recommendation**)" while the kickoff prompt demands "you **decide** all four". Compatible readings, but a literal-minded DESIGNER may hedge with recommendations instead of decisions. One-word tidy: "resolve, stating your recommendation as the decision".
- The kickoff prompt pins the branch as `feature/planning-docs`. Correct today; if the branch merges before M0 runs, the instruction goes stale. Fine to leave — just re-check the line when merging.

**Domain / correctness checks:** Formatting rules transcribed for the designer (GST-inclusive, en-IN, IST, `ORD-2026-1042` ref shape) all match D5 + the lifecycle spec. Status taxonomy matches the derived-lock model. ✓

**What I tried:** Read the kickoff prompt end-to-end; verified all three CSV stress-case rows via grep (names, prices, longest-name ranking); diffed brief + PLAN hunks against the prompt's flow to confirm the three documents agree.

**Open flags (cumulative):** Empty, except standing M1 test obligations. ⑤ (minor, new): brief heading "flag your recommendation" vs. prompt "decide" — tidy opportunistically.

**Next-commit suggestion:** Run the DESIGNER session with the kickoff prompt — the expected next commit is `docs(design): M0 — authored phase1 design prompt for Claude design`, touching only `Prompts/phase1-design-prompt.md`. I will review it against the self-containment test: could Claude design work from that file alone.

---

## Review of f5d217a — docs(design): brief now says decide, not recommend — closes flag 5 before M0 runs

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Close flag ⑤ from my 6d6827f review — the brief's "flag your recommendation" hedged where the kickoff prompt demands decisions — before any DESIGNER session reads the brief.

**What works:** One file, one hunk, exactly the fix: section renamed to "Design decisions to resolve (state your recommendation as the decision)", body now says "Decide all four… zero open questions; the owner can override later" — matching the kickoff prompt's language. Fix landed *before* M0 runs, which is the whole point of the flag.

**Blocking issues:** None. **Non-blocking suggestions:** None.

**What I tried:** Read the full diff; confirmed the brief and kickoff prompt now agree verbatim on the decide-don't-hedge contract.

**Open flags (cumulative):** ⑤ — ✅ CLOSED. The flag list is fully empty; only the standing M1 test obligations remain (they activate when migrations land).

**Next-commit suggestion:** Unchanged — the DESIGNER session's `Prompts/phase1-design-prompt.md`.

---

## Review of 6a1573c — docs(design): M0 — authored phase1 design prompt for Claude design

**Verdict:** ✅ accept — with two commit-message accuracy flags (content itself is excellent)

**Phase / commit goal (as I understood it):** The DESIGNER session's single deliverable: a fully self-contained `Prompts/phase1-design-prompt.md` from which Claude design (no repo access) can produce all Phase 1 designs, with the four open design decisions resolved.

**What works:**
- **The data pack is flawless — verified mechanically, not by eye.** I regenerated the expected catalog from the CSV by implementing seed-data.md's exact rules in a script (BOM/CRLF strip, trim + collapse whitespace runs, position-within-category SKU codes, TBD → hidden): **all 34 rows match exactly on SKU + name + price**, including the subtle part — gap numbering (`ZEB-EAR-07`, `ZEB-PWR-03/04`, `ZEB-SPK-11` where unpriced SKUs hold 05/06, 02/05, and 10/12/13/14). The prompt even warns the designer never to renumber. This is the hardest 30% of the file and it is perfect.
- **Self-containment holds.** I read it simulating a designer with no repo: context capsule, personas/viewports, nine principles, status taxonomy with the derived-lock nuance intact, per-screen contents + states for all 11 screens, global state patterns, en-IN/IST/GST-inclusive formatting, print spec with both variants, and consistent sample data (one worked order — ORD-2026-1042, ₹4,478, editable until 13:42 = 11:42 + 2h ✓ — reused across S3/S4/S9/S10). I could not construct a question that requires the repo.
- **All four design decisions are decided, not hedged** (deep-blue accent with WCAG note; minutes-only text-in-chip countdown, amber <10m, never red/rings/seconds; A4; GE monogram with 192/512/maskable sizes) — each with one-line rationale and "do not reopen". Exactly what the kickoff demanded.
- **Process rules obeyed**: one file, one commit, correct subject line, spec contradictions reported in the message body instead of edited — the DESIGNER did not become a second BUILDER.
- Smart additions beyond the brief: near-identical-pair stress case (TT27 vs TT65 — straight from the problem statement's dispute scenario), "no Draft chip" clarification, Zebronics-red avoidance note on principle 9.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions — commit-message accuracy (the log must stay trustworthy):**
1. **"'3 items · ₹2,584' is not derivable from the priced catalog" is factually false.** I brute-forced it: **488** three-distinct-line combinations reach ₹2,584 (e.g. 1×₹60 + 7×₹72 + 20×₹101). The true statement: the spec's example named no basket and was presumably invented. The substitution with a named, checkable basket is still an improvement — but the claim as written overreaches.
2. **Misattribution:** the message says designer-session-prompt.md "quotes the same abbreviated form" — it contains no ASTRA mention at all (`grep -i` clean). The second abbreviated occurrence is [salesman-app.md:33](docs/specs/salesman-app.md#L33) ("astra" → ASTRA 40).
3. The first contradiction claim **is** verified: [accountant-dashboard.md:36](docs/specs/accountant-dashboard.md#L36) did say "(ASTRA 40)" where the CSV verbatim name is "(ASTRA 40 BLACK)". Correctly caught, correctly left to the BUILDER.

**Domain / correctness checks:** Money display (whole rupees, en-IN incl. `₹1,02,584` lakh grouping, no tax math — D5 ✓); status taxonomy matches the derived-lock lifecycle ✓; gaps-are-normal note on order refs matches D1 ✓; "no TBD UI state" matches D2 ✓; no-images constraint matches reality ✓.

**What I tried:** Scripted CSV→expected-table regeneration + diff (34/34 exact); subset-sum brute force over the 34 priced values for the ₹2,584 claim; `grep -in astra` across the three claimed files; arithmetic check of the worked order; end-to-end read simulating a repo-less designer.

**Open flags (cumulative):** ⑥ (minor): the two message inaccuracies above — for the record, not for action; the underlying doc fixes landed as 6b0aa56 (next block).

**Next-commit suggestion:** BUILDER fixes the two flagged example-data contradictions (landed as 6b0aa56 before I finished this block). Then: owner hands the prompt to Claude design; the M0-completing commit must record who approved and when.

---

## Review of 6b0aa56 — docs: fix the two example-data contradictions the DESIGNER flagged in 6a1573c

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Close the DESIGNER's two verified contradiction reports: the abbreviated ASTRA name in the dashboard pick-slip mock, and the fabricated ₹2,584 cart-bar example in salesman-app.md + design-brief.md.

**What works — every message claim verified:**
- [accountant-dashboard.md:36](docs/specs/accountant-dashboard.md#L36) now reads `(ASTRA 40 BLACK)` — the CSV-verbatim name ✓.
- Cart-bar examples in [salesman-app.md:34](docs/specs/salesman-app.md#L34) and [design-brief.md:38](design/design-brief.md#L38) now read `₹4,478`, with the basket spelled out and labeled "a real, checkable basket" ✓ (10×60 + 5×364 + 2×1,029 = 600 + 1,820 + 2,058 = 4,478 — re-verified).
- **All example baskets across the repo now agree**: spec pick-slip mock = designer prompt's worked order = cart-bar example. One canonical basket everywhere.
- The message's third paragraph independently reaches the same conclusion my 6a1573c review did — designer-session-prompt.md has no abbreviated ASTRA (the BUILDER grepped; so did I; same result) — and correctly declines to change it. Honest verification, honestly reported.

**Blocking issues:** None.

**Non-blocking suggestions:**
- [salesman-app.md:33](docs/specs/salesman-app.md#L33) still says `("astra" → ASTRA 40)` — acceptable as a search-query→result illustration rather than a name assertion, but if anyone ever "fixes" it, the right form is `→ the ASTRA 40 BLACK row` (as the designer prompt phrases it).

**What I tried:** Read the full diff; recomputed the basket arithmetic; grepped the tree at 6b0aa56 for remaining `₹2,584` / `(ASTRA 40)` occurrences — none outside archive/ and this log's history.

**Open flags (cumulative):** ⑥ closed-as-recorded (message inaccuracies are documented above; the docs themselves are now consistent). Flag list empty; standing M1 test obligations remain.

**Next-commit suggestion:** M0 hand-off — owner runs Claude design with `Prompts/phase1-design-prompt.md`; the completing commit records who approved and when. After that, M1 (`supabase/migrations/0001_*.sql`) is where my test obligations activate.

---

## Review of 6d81e88 — docs: future-plans.md parking lot — order-punch geotagging (owner decision)

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Record an owner-approved-but-unscheduled feature (GPS fix at order submit) in a new parking-lot doc, with its decided shape locked so it never gets re-litigated — plus PLAN.md/README pointers.

**What works:**
- **The parking-lot pattern itself**: decided shape + decision context + explicit "move to PLAN.md and delete here when scheduled" lifecycle — same never-re-litigate discipline as decisions.md, correctly kept out of the committed phases.
- **Every technical claim checks out**: browser geolocation is indeed interaction-moment-only after a one-time permission (background route tracking genuinely requires a native app); 20–150m urban-canyon GPS accuracy is the right expectation for bazaar conditions; and "client-supplied coords are a trust signal, not proof" is the correct trust model — it mirrors the roles-and-permissions stance on client input while honestly acknowledging that, unlike prices, location *cannot* be derived server-side.
- **Fail-open is the right priority call**: `getCurrentPosition` racing the submit with a ~5s attach window, missing fix = soft signal. The "faster than the notebook" rule explicitly outranks the geotag — consistent with the project's core metric.
- **The adoption-risk paragraph is wise**: quiet map link, no "far from shop" enforcement. Visible surveillance killing field-app adoption is a real, documented failure mode of this product category, and rules built on spoofable client coords would indeed be theater.
- Schema sketch is genuinely additive (nullable columns + optional RPC params); nothing pre-built now — matches architecture §8's "no more headroom than needed" doctrine.
- PLAN.md "Unscheduled" pointer + README repo-map row both land and resolve ✓.

**Blocking issues:** None.

**Non-blocking suggestions:**
- **One spec interaction to pin when this is scheduled:** `submit_order` is idempotent — "a retry carrying an existing `id` returns that order untouched." So if the first attempt lands *without* a fix (timeout) and a retry arrives *with* one, the fix is discarded by the idempotency rule. That's acceptable (soft signal), but the future entry should say so explicitly so nobody "fixes" idempotency to merge coords. Suggested line: *the geotag rides the first successful submit only; retries never update it.*
- Owner approval is cited with a date but (per the M0 exit-criterion convention adopted in bc9c10f) future owner-decision commits could name the decision venue/thread. Minor consistency point, not a defect.

**Domain / correctness checks:** No schema/behavior changes now — nothing to execute. Range validation (lat ∈ [-90,90], lng ∈ [-180,180], accuracy > 0) is already specified for the future RPC ✓.

**What I tried:** Read the full diff and new doc; confirmed the README/PLAN links resolve; cross-checked the fail-open flow against the salesman-app resilience spec (no conflict — submit path unchanged) and the idempotency rule (interaction noted above).

**Open flags (cumulative):** Empty; standing M1 test obligations remain. The idempotency×geotag note lives in this block for whenever the feature is scheduled.

**Next-commit suggestion:** Unchanged — M0 design hand-off, then M1 migrations.

---

## Review of 37ce452 — docs: pin the geotag × idempotency interaction in future-plans.md

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Pin the non-blocking note from my 6d81e88 review — geotag rides the first successful submit only; retries never update it — so the idempotency rule can't be weakened to merge coordinates when the feature is eventually scheduled.

**What works:** The pinned paragraph states the rule, the edge case (first attempt lands without a fix, retry arrives with one → fix discarded), why that's acceptable (soft signal), and the explicit prohibition ("do not weaken the idempotency rule to merge coordinates"). Placed in the future-plans entry itself, where the future implementer will actually read it. Semantics match my note exactly.

**Blocking issues:** None. **Non-blocking suggestions:** None.

**What I tried:** Read the diff; cross-checked the wording against the `submit_order` idempotency contract in data-model.md and order-lifecycle.md — consistent with both.

**Open flags (cumulative):** Empty; standing M1 test obligations remain.

**Next-commit suggestion:** Unchanged — M0 design hand-off (noting an untracked `favicon.png` has appeared in the working tree, presumably the GE monogram; I'll review it when it's committed), then M1 migrations.

---

## Review of c82607e — design(m0): import Claude Design deliverable + extracted spec — approved by Mridul, 2026-07-06

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** The M0 milestone deliverable — import the approved Claude Design output (the `Ganpati Phase 1.dc.html` canvas, its 13 static renders, and the `support.js` runtime) and distill it into an implementation-facing `design/phase1-design-spec.md`. The commit message records owner approval ("approved by Mridul, 2026-07-06"), satisfying the M0 exit criterion (who + when) adopted at bc9c10f.

**What works — extraction verified against the source, not by eye:**
- **The tokens are transcribed from the deliverable, not invented.** The three load-bearing colors appear verbatim in the dc.html at the exact hex the spec's token table lists: `#14181F` (ink) ×148, `#1D4ED8` (accent) ×140, `#B45309` (amber) ×18. The canonical worked order `₹4,478` appears 18× and `ORD-2026-1042` 12×; `ASTRA 40 BLACK` 10×.
- **Worked-order arithmetic re-derived from the CSV source of truth:** MU240 = ₹60 ([ZebronicsPriceList.csv:13](data/ZebronicsPriceList.csv#L13)), MA104B = ₹364 ([:4](data/ZebronicsPriceList.csv#L4)), ASTRA 40 BLACK = ₹1029 ([:33](data/ZebronicsPriceList.csv#L33)); 10×60 + 5×364 + 2×1029 = 600 + 1820 + 2058 = **₹4,478**, 3 distinct lines — the same basket used at S3 resume-draft, S4 cart bar, S5, S7, S9, S10. Confirmed visually in render `t4_00.png`.
- **Every referenced asset resolves at the commit:** the source-of-truth link `phase1/Ganpati%20Phase%201.dc.html` (URL-encoded space — correct), `phase1/renders/`, and all 13 render PNGs.
- **Domain invariants survive the extraction intact:** snapshot-at-submit ("catalog price changes never rewrite history", S7), derived lock, ref gaps by design (S8: "…1044 → …1046 are real"), GST-inclusive no-tax figures, IST times, verbatim typo'd names — all consistent with D1/D5 and the lifecycle spec.
- **`support.js` carries an honest provenance header** ("GENERATED from dc-runtime/src/*.ts — do not edit") — imported as a frozen design artifact, not app code.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions (all resolved/refined by 5d8e58c, reviewed next):**
- The extraction **faithfully carries the deliverable's own open contradictions** — correct for an extraction, but it means the spec-at-c82607e is not yet internally consistent: (a) the status line read "Derived (window expiry **or** processed) — same chip either way", which contradicts S7/S8 showing a distinct green `Processed` chip; (b) the bottom tab bar listed Home/New Order/**Sync/Profile** with Sync/Profile explicitly undesigned. Both are owner/builder-resolved in 5d8e58c — logging here so the record shows they were caught at import, not missed.
- **Render gap:** deviation #5 cites "sec-s1…s8 renders" but there is no `sec-s6_00.png` (present: s1,2,3,4,5,7,8). The "…" range overstates the set by one. Cosmetic — the v1 sec-renders are state checklists only (instrument grammar wins), so no screen is actually undesigned.

**Domain / correctness checks:** Money display, status taxonomy, numbering, snapshot immutability — all spec-level correct and consistent with the frozen specs. No executable surface yet; SQL-level verification stays deferred to M1.

**What I tried:** `grep -c` token/sample-data counts in the dc.html; CSV price lookup + arithmetic for the worked order; `git ls-files` render inventory + a `sec-s{1..8}` presence loop; read renders `t4_00.png` (S5/S6/S7/S10) and `sec-s1_00.png` (login states); read the full spec end-to-end.

**Open flags (cumulative):** ⑦ (new, minor): sec-s6 render absent vs the "sec-s1…s8" label. Standing M1 test obligations remain.

**Next-commit suggestion:** Reviewed as landed — 5d8e58c resolves the extraction's open items.

---

## Review of 5d8e58c — design(m0): builder resolutions + owner decisions on the phase1 design spec

**Verdict:** ✅ accept — with two non-blocking documentation flags

**Phase / commit goal (as I understood it):** Resolve the ambiguities the Claude-design extraction left open and record the owner's 2026-07-06 decisions — six edits to the spec plus the receipt-glyph asset.

**What works — each of the six resolutions verified against the diff, the CSV, and the renders:**
1. **Touch targets** ([spec:45](design/phase1-design-spec.md#L45)): now separates the ≥48px hit-area floor from the smaller visual cells (44×50 / 40×42) via invisible padding — "spec floor wins on hit area, design visuals win on pixels." Matches the ≥48px constant and the `sec-s1` render annotation ("48px+ fields and button"). Sound.
2. **Qty cap:** UI keypad cap 999, deliberately stricter than the DB `1..9999` bound verified at bc9c10f. Structurally enforced by "keypad max 3 digits" → ≤999; the two bounds don't need reconciling. Correct fail-safe.
3. **Chip = status** ([spec:56](design/phase1-design-spec.md#L56)): drops the extraction's "same chip either way." Verified well-founded against render `t4_00` S7-states — the design's *visual* already shows three distinct chips (grey `locked`, green `Processed`, red `Cancelled`); only the annotation prose was loose. The edit aligns the spec with the design's own visuals and with the derived-lock model (lock governs edit *permission*, not chip display). Correct.
4. **Bottom tab bar → Home + New Order only** (owner): Sync/Profile tabs cut; the amber unsent square moves to the Home tab, Home's pinned "Saved on phone" strip carries sync truth (verified present in the S2/Home render), sign-out at the bottom of Home. Coherent — no orphaned sync surface. (Introduces flag (a).)
5. **Font-loading mandate:** subset + `font-display: swap` + system fallback stacks (`system-ui` structure; `ui-monospace, Menlo, Consolas, monospace` figures). Right call — the <2s-on-4G persona budget outranks webfont fidelity.
6. **Product mark = receipt glyph** (owner), overriding the designer's GE monogram; adds `design/phase1/favicon.png`. Byte-verified (sha `39d6ec0…`) and read: a zigzag-edged bill with two ink lines in ink `#14181F`, exactly as deviation #6 describes. **This closes the 37ce452 note** where I flagged an untracked `favicon.png` as "presumably the GE monogram" — it is in fact the receipt glyph, and it *supersedes* the monogram.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **(a) Broken forward reference.** Lines [47](design/phase1-design-spec.md#L47) and [96](design/phase1-design-spec.md#L96) both cite "the future Payments tab — see docs/future-plans.md", but `docs/future-plans.md` has **no Payments entry** (`git grep -i payment` at HEAD → nothing; the file holds only the geotag parking-lot). Same class as the README forward-reference flag from 3e5bf1f. Fix cheaply: add a one-line "Payments (Phase N)" stub to the parking lot, or drop the pointer until it exists. → flag ⑧.
- **(b) S1 mark contradiction left half-resolved.** Deviation #6 makes the receipt glyph the icon "everywhere … the S1 login block," overriding the GE monogram — but the S1 screen text ([spec:68](design/phase1-design-spec.md#L68)) still reads "GE monogram block (accent)," and the S1 renders (`sec-s1_00`, `t4_00`) still draw the "GE" monogram (expected — they predate the override). Also unaddressed: the desktop **S8** top-chrome "GE block" ([spec:82](design/phase1-design-spec.md#L82)) — does "everywhere" convert desktop chrome too, or does the monogram survive there? Reconcile line 68 (and clarify S8) with deviation #6 so the builder doesn't copy the monogram straight from the renders. → flag ⑨.

**Domain / correctness checks:** No schema/behavior surface — six doc/spec edits + one static asset. The qty-cap and chip=status edits are consistent with the DB constraints and lifecycle already reviewed.

**What I tried:** read the full diff hunk-by-hunk against the six message claims; `git grep -i payment docs/future-plans.md` (empty); byte-compared the favicon across paths (`git cat-file … | shasum`, identical); read `assets/favicon.png` (receipt glyph) and the S7-states render (chip=status corroboration); confirmed the S2/Home sync-strip and S3 resume-draft ₹4,478 basket in `t4_00`.

**Open flags (cumulative):** ⑦ sec-s6 render gap. ⑧ Payments forward reference (docs/future-plans.md). ⑨ S1/S8 mark vs receipt-glyph override. Standing M1 obligations remain.

**Next-commit suggestion:** a two-line doc fix closing ⑧ (Payments stub) and ⑨ (line 68 → receipt glyph). Then M0 is fully consistent and M1 (`supabase/migrations/0001_*.sql`) is the next build step, where my RLS / snapshot / trigger / qty / retry test obligations activate.

---

## Review of bb1dfd3 — chore: relocate favicon to assets/ as the official app logo/favicon

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Promote the receipt glyph to the repo's canonical logo/favicon by moving it `design/phase1/favicon.png → assets/favicon.png` and repointing the spec link.

**What works:**
- **Pure rename, content untouched:** git reports `similarity index 100% / rename`, and I confirmed byte-identity independently — sha `39d6ec0d…` at both `5d8e58c:design/phase1/favicon.png` and `HEAD:assets/favicon.png`. No re-encode, no size delta.
- **Link repointed and resolves:** [spec:101](design/phase1-design-spec.md#L101) now `[favicon.png](../assets/favicon.png)`; from `design/phase1-design-spec.md` (in `design/`), `../assets/favicon.png` → repo-root `assets/favicon.png` ✓.
- **No dangling references:** `git grep "phase1/favicon.png" HEAD` → none; the only favicon reference repo-wide is the now-correct spec line. The frozen `dc.html` never referenced the favicon (owner-added asset, not part of the design export), so nothing to fix there.

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** N/A — file move + one link.

**What I tried:** `git show --find-renames bb1dfd3` (100% rename), `git cat-file -p … | shasum` on both blobs (identical), `git grep` for the old path and for favicon repo-wide, `grep favicon` in the dc.html (none).

**Open flags (cumulative):** ⑦ sec-s6 gap, ⑧ Payments forward reference, ⑨ S1/S8 mark override — all carried, all doc-only, none blocking. Standing M1 test obligations remain. **M0 is complete** (owner-approved deliverable imported, spec extracted, decisions recorded); the highest-value next commit is M1 migrations, where my execution-based verification finally activates.

---
