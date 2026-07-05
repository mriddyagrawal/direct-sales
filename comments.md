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
