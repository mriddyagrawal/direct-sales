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

## 📋 Open Items Ledger — live, updated every review cycle

**BUILDER: this is the single source of truth for what's outstanding.** Read it before each commit. The REVIEWER rewrites this table every cycle from the per-block "Open flags (cumulative)" lines, so the newest state is always here — you never have to scroll the whole log. 🔴 = blocking (fix before new functionality), 🟡 = non-blocking, ✅ = closed (kept briefly for the audit trail, then pruned).

**No 🔴 blocking items open.** All items are minor / deferred / owner-config. M1 backend + M2 seed verified complete against the live project; M4 (salesman order flow) is **complete and reviewer-verified** — infra (96880f5), S3–S6 create (97272b4), S7 detail/edit/cancel/history (9ccac24), all live-verified (idempotent submit, double-tap→one row, server post-expiry reject, `order_events` reconstruction). Flags ㉓ ㉔ ㉕ ㉖ ㉗(a) **all closed** via the builder's fix commits (48ed20f, 48913ec). **M5 (accountant dashboard) kicked off** (prompt 03b7fa0); ㉘ (edit-reason RPC) + ㉙ (runbook) **closed** at a4f899 — `update_order_items` now takes a mandatory-past-lock `p_reason` (verified live end-to-end: salesman path intact, post-window reason enforced, snapshot pin holds), and Realtime is enabled on `orders`. S8 dashboard (nav shell + live orders list, f757b17) landed; ㉚ (3 polish items) **closed** at 7a475de. **M5 (accountant dashboard) complete and reviewer-verified** — S8 list · S9 workbench · S10 pick-slip · S11 retailers · Products pricing; #2 (process_order rejects salesman), #3 (post-lock edit-reason), #6 (TBD→salesman-visible) **proven live**; #1/#4/#7 wall-clock/print/phone await a live browser. **㉗(b) closed** (D10 — owner confirms real staff names). PLAN Now-line → M6 (deploy + pilot). Open: 🟡 ㉜ (dashboard-UX stale-after-save + polish, fix-prompt 0a9c77e — **fix before prod**; 🅐 was a REVIEWER miss), 🟡 ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. **Live-DB note:** real orders exist (owner's testing); I never reset `order_no_seq` (D1 permits gaps).

| Flag | Item | Severity | Origin | Status |
|---|---|---|---|---|
| ㉜ | **Dashboard UX (owner found testing M5; fix-prompt 0a9c77e).** 🅐 **stale-after-save (real bug — REVIEWER miss at 711ef1d + 983554a):** `RetailersQueue`/`ProductsPricing` freeze server data in `useState(initialX)` (no setter), so `router.refresh()` after a write re-renders with preserved state → the row stays stale until a full reload (DB write itself is fine, RLS-verified). 🅑 Deactivate/Reactivate/Edit show no spinner + `saving` clears before the refresh paints (use per-action spinner + `useTransition`/`isPending`). 🅒 no discoverable verify — add an explicit "Review & verify" primary on pending rows (no RLS change). 🅓 `tally_name` should fall back to `products.name` on read (don't copy into the column). | 🟡 functional/UX — **fix before prod** | app M5 (711ef1d/983554a) — owner testing | 🟡 open — awaiting fix commit |
| ㉛ | **Hardening — least privilege on `order_no_seq`.** `anon` has `USAGE` and `authenticated` has `UPDATE` on `public.order_no_seq` (Supabase default sequence grants). **Not exploitable today** — `setval`/`nextval` aren't reachable through the Supabase API (they live in `pg_catalog`, not the exposed `public` schema; no `/rpc/setval`), and `submit_order` is `security definer` so it runs the sequence as its owner regardless of the caller's grant. But it's broader than needed. Fix: `revoke select, usage, update on sequence public.order_no_seq from anon, authenticated;` then confirm `submit_order` still assigns `order_no`. Recorded in **PLAN.md's open-items** by the reviewer per the owner's explicit request (2026-07-07). | 🟡 hardening / deferred | reviewer 2026-07-07 (MCP-access audit) | 🟡 open — **owner: not required now**; do at go-live hardening |
| ㉚ | S8 orders-list polish (×3): (1) `window` keydown hijacks Arrow keys even when a `<select>`/input is focused → can't keyboard-navigate the filter dropdowns (exempt form controls, as it does for `/`); (2) salesman filter matches by `full_name` not `salesman_id` (add `salesman_id` to the select) — fine at 1–2 salesmen; (3) Realtime UPDATE patches `total_paise` but not the joined `order_items` count → LINES stale after an edit until refresh (refetch the joined row on UPDATE too). | 🟡 was polish | app M5 S8 (f757b17) | ✅ **CLOSED** at 7a475de — `isFormField` guard on arrows; filter by `salesman_id`; UPDATE refetches the joined row; tsc/eslint clean |
| ㉘ | M5 acceptance #3 (post-lock edit **reason**) isn't RPC-ready: `update_order_items(p_order_id,p_notes,p_items)` has no reason param and writes no `reason` into the `edited_after_lock` event `details` (verified live). Spec lists `reason?` as optional and `describeEvent` already reads it, but no migration writes it. Needs a security-definer RPC change (add `p_reason` → `details.reason`) — the M5 prompt implies the RPC is already ready ("already enforces this"), which is only true for the snapshot semantics. | 🟡 was M5 prereq | M5 prompt (03b7fa0) | ✅ **CLOSED** at a4f899 — `p_reason` added (mandatory for `edited_after_lock`, folded into `details.reason`); salesman in-window path + snapshot pin re-verified live |
| ㉙ | add-user runbook's "Why it's these steps" says `email_for_username` is **anon-callable** — false post-㉑ (live grants: anon=false, auth=false, service_role=true). Login is client → server action → **service-role** client → `email_for_username`. Operational steps are fine; the explanation is wrong and, if trusted, could invite re-granting anon (reopening the ㉑ harvest). | 🟡 was doc | M5 runbook (03b7fa0) | ✅ **CLOSED** at a4f899 — runbook now describes the Server Action + service-role flow; matches live grants |
| ㉖ | `PendingOrdersStrip.sync` (S7) silently `removePending` on a **non-**`OfflineError` (a real server rejection, e.g. a product went unavailable → `P0001`) with no message → the "Saved on phone" strip vanishes exactly like a success, but the order was **discarded**. Silent loss + false-success. Correctly avoids infinite retry, but should surface the failure (keep it in an error state + reason), not drop it. [PendingOrdersStrip.tsx:36](src/components/PendingOrdersStrip.tsx#L36). | 🟡 was silent-loss | app M4 S7 (9ccac24) | ✅ **CLOSED** at 48913ec — `markPendingFailed` keeps it visible with the reason + Try again/Discard; auto-retry skips failed entries |
| ㉗ | S7 UX: **(b)** HISTORY renders real staff **names**, not the "the office" the code falls back to (`profiles_select_active`, M1, lets any active staff read the directory) — **owner-confirm** surfacing staff names to salesmen is intended. *(㉗(a) — misleading offline copy — closed at 48913ec.)* | 🟡 was owner-confirm | app M4 S7 (9ccac24) | ✅ **CLOSED** 2026-07-07 (D10) — owner confirms **real names**; current behavior stays, no code change |
| ㉕ | `Review`/`QuickOrder` build their display maps from the **current** catalog only, but `total` + the submit payload iterate the full `items`. A line whose product left the salesman's active+priced catalog (edit within the 2h window after office deactivates/unprices it, or a resumed create-draft) is **hidden from the list yet still counted & submitted** → edit: total ≠ visible lines + un-removable ghost; create: whole-order rejection whose offending line is invisible. No data loss. Fix: `select order_items.product_name` in the edit query + merge unknown ids into the maps as "unavailable — remove". | 🟡 was display edge | app M4 S3–S6 (97272b4) | ✅ **CLOSED** at 48ed20f — `snapshotNames` carried; stale line shown removable (edit) / pruned (create); `tsc`+`eslint` 0 |
| ㉓ | `order-rpcs.ts` offline classifier: a fetch failure supabase-js *resolves* (not throws) while `navigator.onLine` still reads `true` (wifi-no-internet / captive portal / DNS fail) is misclassified as an **authoritative server rejection** → not queued for retry → silent-loss risk (**proven by execution**). Discriminate on the presence of a Postgres error `code` (a real rejection carries a SQLSTATE; a transport failure has none), not `navigator.onLine`. | 🟡 was silent-loss risk | app M4 infra (96880f5) | ✅ **CLOSED** at 97272b4 — classifier keys on SQLSTATE `code` presence; verified by node across 7 failure shapes (the wifi-no-net case now → `OfflineError`/retry) |
| ㉔ | `toItemsPayload`/cart don't strip `qty<=0`, but Stepper+keypad can set 0 (= remove line). A zero-qty line reaching `submit_order` fails the DB `qty between 1 and 9999` check and **rejects the whole order**. Filter `qty>0` when building the payload (or drop zero keys on cart write). | 🟡 was functional gap | app M4 infra (96880f5) | ✅ **CLOSED** at 97272b4 — `toItemsPayload` filters `qty>0` + reducer `delete`s zero keys; verified by execution |
| ㉒ | `SUPABASE_SECRET_KEY` (new-style `sb_secret_…`) must be set or **username login fails** — the secret-key lookup can't run without it. | 🟡 was config / owner | app ㉑-fix (0db66fd) | ✅ **RESOLVED** at ba387fa — owner set it in `.env.local`; verified valid (lookup returns the email). Still add it to **Vercel env** before deploy. |
| ㉑ | `email_for_username()` (username-login lookup) was `anon`-executable → a guessed username returned that account's email (**proven live**). | 🟡 was security | app D9 (39cf779) | ✅ **CLOSED** at 0db66fd — revoked anon/auth, service-role-only; harvest now denied (verified), advisor clear |
| ⑱ | `middleware.ts` redirect branches don't copy `supabaseResponse` cookies onto the redirect → deactivated-user **infinite redirect loop** + intermittent token-refresh logouts. Copy cookies onto each authenticated redirect. | 🔴 was correctness-blocking | app auth (dcb3904) | ✅ **CLOSED** at 0dc60a3 — `redirectWithCookies` copies cookies onto all 4 redirects; build+lint clean |
| ⑬ | Drift-protected `scripts/seed.ts` loader (seed-data.md's `--force-prices`/warn-on-drift re-run guard) deferred until the Node app is scaffolded. Re-seeding before it exists could clobber in-DB price edits. | 🟡 minor / deferred | M1.7 | 🟡 open (deferred to app scaffold) |
| ⑭ | RLS/index performance pass — 4 `get_advisors(performance)` categories (multiple permissive policies, unwrapped `auth.uid()`, **6** unindexed FKs incl. `orders.cancelled_by`, 1 unused index). Verified accurate + harmless at current scale. | 🟡 minor / deferred | M1 (7cc9e4c) | 🟡 parked in [docs/future-plans.md](docs/future-plans.md); revisit with Pro-billing decision |
| ⑦ | `sec-s6` render absent vs the "sec-s1…s8" range label in the design spec. | 🟡 minor / doc | M0 (c82607e) | 🟡 open |
| ⑧ | Design spec cites a "future Payments tab — see docs/future-plans.md" entry that doesn't exist yet. | 🟡 minor / doc | M0 (5d8e58c) | 🟡 open |
| ⑨ | S1 screen body + renders still show the GE monogram that deviation #6 overrides with the receipt glyph; the desktop S8 "GE block" mark is unclarified. | 🟡 minor / doc | M0 (5d8e58c) | 🟡 open (S1 mark code now correct; spec text unreconciled) |
| ⑳ | S2 salesman Home doesn't apply the D8 self-cancel filter — a self-cancelled order would still show in the list. Add `.or('status.neq.cancelled,cancelled_by.neq.<uid>')`. | 🟡 was functional gap | app S2 (32c1c96) | ✅ **CLOSED** at fefd9260 — filter applied; self-hidden/office-visible verified live |
| ⑯ | `auth_leaked_password_protection` disabled — enable the HaveIBeenPwned check in Supabase Auth settings (Dashboard toggle, not a migration). | 🟡 minor / config | M1 (a6ec10a advisor) | 🟡 open — homed as PLAN Q#7 (owner enables before pilot) |
| ⑲ | Self-referential `--font-structure`/`--font-figures` in globals.css (same name next/font assigns) → equal-specificity cycle; Space Grotesk may silently drop depending on CSS load order. Use distinct names or drop the redeclaration. | 🟡 was css | design system (7f65371) | ✅ **CLOSED** at 345dce2 — distinct names (`--font-space-grotesk`/`--font-jetbrains-mono`); no cycle, confirmed in served CSS |
| ⑰ | `npm run lint` fails (exit 1) — but only on the frozen `design/phase1/support.js` deliverable; `src/` app code is clean. Add `design/**` to `eslint.config.mjs` `globalIgnores` so the lint gate is green. | 🟡 minor / tooling | app scaffold (54a3171) | ✅ **CLOSED** at dcb3904 — `design/**`+`archive/**` ignored; `npm run lint` exit 0 |
| ⑮ | D8 filter must scope to **self**-cancels only (`cancelled_by = salesman_id`), else an accountant-cancelled order silently vanishes from the salesman's list. | 🔵 was design gap | M1 (3496c17) | ✅ **CLOSED** at M1.9 (a6ec10a) — `cancelled_by` added; self/office distinction verified live |
| ⑪ | Rename `current_role()` → `auth_profile_role()` (reserved-keyword footgun). | 🔴 was blocking — owner directive | M1.5/M1.6 | ✅ **CLOSED** at M1.8 — rename complete; RLS (OID-bound) + RPCs re-verified live |
| ⑩ | RLS fail-open on all 7 tables (anon-readable staff PII; authenticated self-promotion; direct writes bypassing RPCs). | 🔴 was blocking | M1.1–1.3 | ✅ **CLOSED** at M1.6/M1.6b — verified by the 6-step RLS protocol |
| ⑫ | `search_path` unpinned on the three trigger functions. | 🟡 minor | M1.4 | ✅ CLOSED at M1.6b |

**Standing test obligations (REVIEWER):** RLS 6-step protocol ✅ (M1.6, re-verified post-rename at M1.8) · snapshot/idempotency/qty/guard RPC suite ✅ (M1.5, re-verified through RLS + rename) · M2 post-seed catalog check ✅ (M1.7, 42 products vs CSV) · Tally-export idempotency — not yet (Phase 2).

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

## Review of cb24512 — feat(supabase): M1.1 — profiles table + shared helpers

**Verdict:** ❌ reject — two blocking issues (a **live** RLS exposure; a reserved-keyword function name). The table, helpers, and trigger themselves are built correctly and verified against the live DB.

**Phase / commit goal (as I understood it):** First M1 migration — `public.profiles` per data-model.md, the `current_role()` RLS role-helper, a generic `touch_updated_at()`, and an `auth.users`-insert trigger that auto-provisions a salesman profile (D3). Applied live to project `ugjwcbxyyuowiyhczcrh`.

**What works — verified against the live DB, not the SQL text:**
- `profiles` columns match the spec exactly: `id uuid PK → auth.users(id)`, `full_name text NOT NULL`, `role text NOT NULL default 'salesman'`, `active boolean NOT NULL default true`, `created_at timestamptz NOT NULL default now()`. Role CHECK is live: `role = ANY('admin','accountant','salesman')`. ✓
- `current_role()`: `security definer`, `stable`, `search_path=public, pg_temp` pinned; returns NULL for a caller with no active profile → fail-closed as intended. ✓
- `create_profile_for_new_user()`: `security definer`, search_path pinned; the `on_auth_user_created` AFTER INSERT trigger on `auth.users` **exists and is enabled** (`tgenabled='O'`) — the message's "verified installed … enabled" is accurate; the hosted-platform trigger risk did not materialize. ✓
- Default role `salesman` + admin-promotes-in-Studio matches D3. ✓

**Blocking issues (must fix before the RLS-policy migration / before any seed):**
1. **RLS is NOT enabled on `public.profiles`, and the table is live-readable/writable via the API keys.** data-model.md:9 mandates "RLS is enabled on every table (default deny)"; the security advisor flags this ERROR-level (`rls_disabled_in_public`). I proved it is a *live fail-open* exposure, not a lint nag: `has_table_privilege('anon','public.profiles','SELECT') = true` and `has_table_privilege('authenticated','public.profiles','UPDATE') = true`, with RLS off. So right now anyone holding the public anon key can `SELECT` every staff row (id, name, role, active), and any signed-in user can `UPDATE profiles SET role='admin' WHERE id = auth.uid()` — privilege self-escalation. Fix is one line in this migration: `alter table public.profiles enable row level security;` (deny-all until policies land). See the M1.2 block for why the "defer RLS" rationale is backwards.
2. **`current_role` collides with a PostgreSQL reserved keyword.** `select current_role()` (unqualified) is a hard **syntax error (42601)** — I ran it live; only `select public.current_role()` works. roles-and-permissions.md:49 describes the helper unqualified as `current_role()`. When the RLS-policy migration is written, an unqualified `current_role()` won't compile, and the paren-less `current_role` silently resolves to the Postgres *session* role (`authenticated`), breaking every role check (potentially fail-open). Rename the helper (`app_role()` / `current_app_role()`) before writing policies, and correct the spec prose.

**Non-blocking suggestions:**
- `touch_updated_at()` has an unpinned `search_path` (advisor WARN `function_search_path_mutable`) — pin `set search_path = public, pg_temp` to match the other two, even though it isn't `security definer`.
- Revoke `EXECUTE` on `current_role()` and `create_profile_for_new_user()` from `anon`/`authenticated` (advisor WARN ×2 — both exposed at `/rest/v1/rpc/*`). They're internal; `create_profile_for_new_user` referencing `NEW` outside a trigger would error on a direct RPC call, but tightening the surface is free.

**Domain / correctness checks:** State machine / numbering / money — N/A here. **RLS — FAILED** (item 1, proven live). Role helper — installed but mis-named (item 2). Snapshot/immutability — later migrations.

**What I tried:** `get_advisors(security)`; `information_schema.columns` (profiles shape); `pg_proc.prosecdef/provolatile/proconfig` (all three functions); `pg_trigger.tgenabled` (`on_auth_user_created`); `pg_constraint` (role CHECK); `has_table_privilege('anon'|'authenticated', …)`; `select public.current_role()` (→ null) vs `select current_role()` (→ 42601).

**Open flags (cumulative):** ⑦–⑨ (doc, unchanged). **⑩ (BLOCKING) RLS disabled with live anon/authenticated grants on every public table** — proven fail-open. **⑪ (BLOCKING) `current_role` reserved-keyword collision** — rename before RLS policies.

**Next-commit suggestion:** the RLS migration — but first (a) rename `current_role` → `app_role`, (b) `enable row level security` on all seven tables immediately (deny-all), then add the roles-and-permissions.md matrix. Re-run `get_advisors` to confirm zero `rls_disabled_in_public` before any seed lands.

---

## Review of 97c8ae0 — feat(supabase): M1.2 — catalog tables (brands, products, retailers)

**Verdict:** ❌ reject — DDL is flawless and verified live; blocked by the same live RLS exposure (⑩), and the commit message's stated rationale for deferring RLS is affirmatively wrong.

**Phase / commit goal (as I understood it):** brands / products / retailers per data-model.md, plus the catalog-listing index.

**What works — verified live:**
- All three tables match the spec verbatim. `products.price_paise integer CHECK (price_paise > 0)` with NULL = TBD (D2) ✓; `retailers.verified boolean NOT NULL default false` (fail-closed — the flag-5 fix from bc9c10f) ✓; `created_by → profiles(id)` ✓; `tally_name` / `tally_ledger_name` Phase-2 headroom present ✓.
- `products_brand_category_idx on (brand_id, category, active)` exists ✓.

**Blocking issues:**
1. **⑩ extended to brands/products/retailers** — all three are anon-SELECT/INSERT and authenticated-full-CRUD with RLS off (`has_table_privilege` confirmed). A signed-in salesman can rewrite catalog prices or flip `verified` on any retailer today.
2. **The message's rationale is backwards.** It defers RLS "so tables are never enabled-without-policies." But *enabled-without-policies is the safe state* — RLS with zero policies denies everyone (fail-closed). The current *disabled-in-public* state is the unsafe one: with the default anon/authenticated grants (confirmed present), disabled RLS = fully open. The correct Supabase pattern is `enable row level security` in the same migration as `create table`, then add policies. Enable RLS on all seven tables now; the policy matrix can still land later without leaving a fail-open window.

**Non-blocking suggestions:** none beyond ⑩'s remediation — the DDL itself needs no change.

**Domain / correctness checks:** Catalog integrity — schema supports it (price>0, NULL-TBD, fail-closed verified all in place). Money — `price_paise integer` correct. **RLS — FAILED** (systemic).

**What I tried:** `git show` DDL vs data-model.md; live `has_table_privilege` (anon/authenticated); `pg_indexes` (index present); `pg_constraint` dump.

**Open flags (cumulative):** ⑩ now spans brands/products/retailers. ⑪ unchanged. ⑦–⑨ unchanged.

**Next-commit suggestion:** as M1.1 — RLS enable + `current_role` rename + policy matrix, before seed.

---

## Review of 7e8c021 — feat(supabase): M1.3 — orders core (order_no_seq, orders, order_items, order_events)

**Verdict:** ❌ reject — DDL is exactly to spec and verified live; blocked solely by the systemic RLS exposure (⑩) now reaching the transactional tables.

**Phase / commit goal (as I understood it):** the transactional core — `order_no_seq`, `orders`, `order_items` (immutable snapshot columns), append-only `order_events`, and four indexes.

**What works — verified live (this is the hardest schema in the spec, and it's faithful):**
- `order_no_seq start 1001`, `last_value` still null (never advanced — correct, no orders yet; matches D1 unique+monotonic, gaps-ok). ✓
- `orders`: `id uuid PK` (client-generated idempotency key), `status CHECK (submitted/processed/cancelled)` ✓, `UNIQUE(order_no)` + `UNIQUE(order_ref)` ✓, `total_paise bigint` ✓, `submitted_at`/`editable_until` NOT NULL ✓.
- `order_items`: `qty CHECK (qty >= 1 AND qty <= 9999)` (flag-4 fat-finger bound) ✓; `line_total_paise bigint` ✓ (9999 × ₹9,138 overflows int4 — correctly widened) while `unit_price_paise integer` correctly stays int4; `UNIQUE(order_id, product_id)` ✓; snapshot columns `product_name` / `unit_price_paise` NOT NULL present ✓; `on delete cascade` ✓.
- `order_events`: `bigint generated always as identity` PK ✓, `jsonb details default '{}'` ✓ — append-only shape.
- All four indexes present (`orders_salesman_submitted_idx`, `orders_status_submitted_idx`, `order_items_order_idx`, `order_events_order_idx`). ✓

Every 99d60ab / bc9c10f implementation flag (qty bound, bigint totals, client-UUID idempotency, snapshot columns) is physically present. Excellent fidelity.

**Blocking issues:**
1. **⑩ again:** orders / order_items / order_events are anon-SELECT/INSERT and authenticated-full-CRUD with RLS off. Until RLS + the RPC-only write model land, any anon key holder can read all orders and any signed-in user can INSERT/UPDATE/DELETE order rows directly — **bypassing the entire `security definer` RPC guard chain the design depends on**. Enable RLS on these three in the next migration.

**Non-blocking suggestions:** none — the DDL needs no changes.

**Domain / correctness checks:** Numbering (seq@1001, unique) ✓; money (bigint line/total, int4 unit) ✓; snapshot columns present (immutability enforced later by the RPC) ✓; state-machine enum ✓. **RLS — FAILED** (systemic ⑩).

**What I tried:** `git show` vs data-model.md + order-lifecycle.md; live `pg_sequences`, `pg_constraint`, `information_schema.columns` (bigint check), `pg_indexes`, `has_table_privilege`.

**Open flags (cumulative):** ⑩ spans all seven tables now; ⑪ `current_role` rename. Standing M1 obligations (snapshot / trigger-interaction / idempotent-retry tests) activate once M1.4 (triggers, already committed — next in my queue) and the write-RPC migration land.

**Next-commit suggestion:** the RLS migration (enable all 7 + rename + policy matrix + write RPCs). Then I run the 6-step RLS protocol and the snapshot/trigger/retry tests against real authenticated clients.

---

## Review of 8163ac7 — feat(supabase): M1.4 — triggers (touch_updated_at, recompute_order_total, guard_order_transition)

**Verdict:** ✅ accept — all three triggers verified live by driving real orders through them.

**Phase / commit goal (as I understood it):** Attach `touch_updated_at` to products/orders; add `recompute_order_total` (AFTER I/U/D on order_items → sync `orders.total_paise`) and `guard_order_transition` (BEFORE UPDATE on orders → reject illegal status edges).

**What works — verified by execution (harness in the M1.5 block):**
- Installed exactly as specced: `recompute_order_total` AFTER INSERT/UPDATE/DELETE on `order_items`; `guard_order_transition` + `touch_updated_at` BEFORE UPDATE on `orders`; `touch_updated_at` BEFORE UPDATE on `products` (pg_trigger tgtype 29/19 confirm the timings).
- **The flag-2 trigger interaction is proven, not asserted.** `submit_order` inserts items → `recompute_order_total` updates `orders.total_paise` → that write fires `guard_order_transition` (BEFORE UPDATE orders) → the guard sees `new.status = old.status` and passes it through. My submit returned `total_paise=50000` with no error; had the guard blocked the internal total write, submit would have raised. It didn't. ✓
- **guard rejects illegal edges:** a direct `update orders set status='submitted'` on a processed order raised *"illegal order status transition"* ✓; legal edges passed ✓.

**Blocking issues:** None.

**Non-blocking suggestions:**
- `recompute_order_total` and `guard_order_transition` don't pin `search_path` (advisor `function_search_path_mutable`; same gap as `touch_updated_at`). Not `security definer` so risk is low, but pin for consistency. → flag ⑫. *(Fixed one commit later in M1.6b — see below.)*

**Domain / correctness checks:** State machine — guard enforces submitted→processed/cancelled + processed→cancelled, rejects the rest ✓. Trigger interaction (flag-2) ✓. Money recompute ✓.

**What I tried:** `pg_trigger` timings, then the full lifecycle harness in the M1.5 block.

**Open flags (cumulative):** ⑩ RLS (BLOCKING at this point), ⑪ `current_role` rename, ⑫ (new, minor) search_path on the two new trigger fns.

**Next-commit suggestion:** the RLS migration (full checklist in the M1.5 block).

---

## Review of 7d252d5 — feat(supabase): M1.5 — RPCs (submit_order, update_order_items, cancel_order, process_order)

**Verdict:** ✅ accept — the four write RPCs are behaviorally correct on **every** standing obligation, verified by execution against real orders. Two carried items: the RPC-only write model is only *enforced* once ⑩ RLS lands (M1.6, reviewed below), and the owner has directed the `current_role` rename (⑪).

**Phase / commit goal (as I understood it):** The only sanctioned order write paths — submit / edit / cancel / process — all `security definer`, `search_path` pinned, with role/ownership/time checks against `auth.uid()`/`now()` inside the body (client never trusted).

**What works — proven, not read. I drove the whole lifecycle under simulated salesman + accountant JWTs in one rolled-back transaction:**
- **[submit] snapshot + numbering + window:** 5×₹100 → `total_paise=50000`; `order_ref = ORD-2026-1001` (IST-year via `at time zone 'Asia/Kolkata'`); `editable_until − submitted_at = exactly 02:00:00`; line snapshot `unit_price_paise=10000`. ✓
- **[idempotent retry] (flag-3):** re-calling `submit_order` with the same `id` but qty 99 and different notes returned the original order untouched — db total stayed 50000, notes stayed `'first note'`. No merge. ✓✓
- **[snapshot preservation across a catalog price change] (flag-1 — the delete-and-reinsert trap):** changed catalog price ₹100→₹200, then edited the surviving line; it kept `unit=10000 / line=50000` (NOT re-snapshotted to 20000). The diff-by-`product_id` implementation holds. ✓✓✓
- **[qty bound] (flag-4):** qty 10000 rejected. ✓
- **[role gating]:** salesman calling `process_order` rejected; accountant processed it (`status→processed`, `processed_by = caller`). ✓
- **[post-lock]:** salesman editing a processed order rejected. ✓
- **[guard interaction] (flag-2):** illegal processed→submitted blocked. ✓
- **[audit trail]:** `order_events` recorded `submitted, items_changed, processed` in order; payloads carry `{sku, qty, unit_price_paise}` via the products join (flag-7). ✓

Every implementation trap I pinned at 99d60ab (flags 1–7) is now demonstrably handled in code. Strongest commit in the project so far.

**Blocking issues (on M1.5's own surface):** None — the RPCs are correct and search_path-pinned.

**Carried / directive items:**
1. **⑩ (systemic):** these RPCs are only the *enforced* write path once RLS is on **and** direct INSERT/UPDATE/DELETE on `orders`/`order_items`/`order_events` is **revoked** from `anon`/`authenticated` (data-model.md:140). *(Resolved by M1.6 — see below.)*
2. **⑪ `current_role` rename — OWNER DIRECTIVE (Mridul, 2026-07-06). STILL OPEN as of HEAD.** The helper `current_role()` shadows a reserved SQL keyword: `select public.current_role()` works (verified NULL / fail-closed with no auth), but bare `current_role` (no parens) silently returns the Postgres **session** role, and `current_role()` unqualified is a hard syntax error — both confirmed live. Every call site (the 4 RPCs and all M1.6 policies) currently uses the **qualified** `public.current_role()`, so nothing is broken today — but per the owner, **rename it to `public.auth_profile_role()`** to kill the footgun before more policies accrete, and repoint every call site (4 RPCs + all RLS policies) + the spec prose (roles-and-permissions.md:49). This is an owner-mandated change, not optional.

**Non-blocking suggestions:** revoke `EXECUTE` on the internal `security definer` helpers from `anon`/`authenticated` (advisor WARNs). *(Done in M1.6b.)*

**Domain / correctness checks:** Immutable snapshots ✓ (flag-1 proven); idempotency ✓ (flag-3); qty bound ✓ (flag-4); state machine + guard ✓ (flag-2); numbering/IST-year ✓; money (bigint, server-recompute, client price ignored) ✓; event trail w/ sku ✓ (flag-7).

**What I tried:** `pg_proc` install-check; then a self-rolling-back `DO` block — created two `auth.users` (→ auto-profiles; one promoted to accountant), a brand/product/retailer, set `request.jwt.claim.sub` per role, ran submit → idempotent-retry → price-change+edit → qty-bound → role-gate → process → guard → post-lock-edit → event-trail. All nine passed; the block `RAISE`d at the end so everything rolled back. (It consumed `order_no` 1001–1002 via non-transactional `nextval`; I `setval`'d the sequence back to 1001 afterward, so the first real order is still ORD-2026-1001.)

**Open flags (cumulative):** ⑩ (resolved by M1.6). ⑪ `current_role` → `auth_profile_role` rename (OWNER DIRECTIVE, OPEN). ⑫ search_path (resolved by M1.6b).

**Next-commit suggestion:** RLS landed as M1.6 (next block). After the ⑪ rename, I re-run the RLS protocol against the renamed helper.

---

## Review of 1c3863e — feat(supabase): M1.6 — RLS matrix across all 7 tables

**Verdict:** ✅ accept — closes the ⑩ blocker; RLS enforcement verified by the full 6-step protocol against real authenticated roles. The `current_role` rename (⑪) is still owed.

**Phase / commit goal (as I understood it):** Enable RLS on all seven tables and apply the roles-and-permissions.md matrix; revoke Supabase's default CRUD so writes to orders/order_items/order_events are RPC-only.

**What works — verified live by SET ROLE authenticated + per-role JWTs (the 6-step protocol I promised since planning):**
- **`revoke all … from anon, authenticated`** on all 7 tables *before* granting the matrix — so "RLS on + no policy" and "no grant" both fail closed. ✓ Correct ordering; directly fixes the fail-open state I proved at M1.1–1.3.
- **RLS enabled on all 7** (list_tables + `pg_class.relrowsecurity`). ✓
- **Ownership isolation:** salesman s1 sees exactly 1 order (own), s2 sees only `TEST-9002`; accountant sees both. ✓
- **D2 at the DB layer:** salesman sees 34 priced products (the real seed) — the 8 unpriced are invisible; accountant sees all 42. Verified against the *seeded catalog*, not a synthetic pair. ✓✓
- **Self-promotion blocked:** salesman `UPDATE profiles SET role='admin' WHERE id=self` raised (WITH CHECK pins role/active to the pre-update values); role stayed `salesman`. ✓ This is the exact escalation path I flagged at M1.1 — now closed.
- **RPC-only writes enforced:** salesman direct `insert into orders` denied (SELECT-only grant, no policy); order_items/order_events carry no client write grant anywhere. ✓
- **anon fully locked out:** anon read of profiles denied. ✓
- Policy shape matches the matrix: retailer quick-add forced `verified=false, created_by=auth.uid()`; brands/products INSERT admin-only; accountant no profiles UPDATE. ✓

**Blocking issues:** None — ⑩ is resolved.

**Non-blocking / carried:**
- **⑪ `current_role` rename (OWNER DIRECTIVE) still open** — every policy here calls `public.current_role()` qualified (works), but the rename to `public.auth_profile_role()` should sweep these policies too. Do it as one atomic rename migration (drop-and-recreate policies + function) so no call site is missed.
- Minor: `profiles_select_active` uses `current_role() is not null` (any active staff can read all profiles). Matches the spec ("names appear on orders"), just noting the whole staff directory is readable by every salesman — acceptable for this app.

**Domain / correctness checks:** RLS matrix — **PASSED** all six protocol steps ✓. State machine / snapshots — unaffected (writes still via RPC). Money — unaffected.

**What I tried:** `get_advisors` (0 `rls_disabled_in_public`); a `DO` block that created 2 salesmen + 1 accountant, priced/unpriced products, two orders, then `set local role authenticated` + `request.jwt.claim.sub` per identity to assert ownership isolation, D2 visibility, self-promotion block, direct-write denial, and anon lockout; rolled back via RAISE.

**Open flags (cumulative):** **⑩ RLS — ✅ CLOSED (verified).** ⑪ `current_role` → `auth_profile_role` rename (OWNER DIRECTIVE, OPEN). ⑫ (closed by M1.6b).

**Next-commit suggestion:** the ⑪ rename migration; then app scaffolding (M2+).

---

## Review of 13b6bc2 — fix(supabase): M1.6b — close get_advisors(security) findings after RLS

**Verdict:** ✅ accept — advisor surface cleaned to only the unavoidable, correctly-reasoned warnings; verified by re-running the advisor and the grant checks.

**Phase / commit goal (as I understood it):** Clear the 17 post-RLS security-advisor findings: pin `search_path` on the three trigger functions, and stop `anon` from being able to execute the security-definer functions.

**What works — verified live:**
- **The two-step revoke is real and correct.** The first file revoked `EXECUTE … from PUBLIC`, which (as the message honestly documents) left Supabase's *direct* `anon`/`authenticated` function grants intact; the second file revokes explicitly by role name. I confirmed the end state: `has_function_privilege('anon','submit_order',…)=false`, `anon current_role=false`, while `authenticated` retains both. ✓
- **`create_profile_for_new_user` granted to nobody** — correct: it's `RETURNS TRIGGER`, invoked only by the `on_auth_user_created` trigger (which doesn't need the session to hold EXECUTE). ✓
- **search_path pinned** on `touch_updated_at` / `recompute_order_total` / `guard_order_transition` — closes ⑫. ✓
- **Advisor re-run: 0 `rls_disabled_in_public`, 0 `function_search_path_mutable`, 0 anon-executable.** The **5 remaining WARNs** are all `authenticated`-can-execute-security-definer for `current_role` + the 4 RPCs. The BUILDER's call to accept these is **correct**: the RPCs *must* be authenticated-callable (that's the RPC-only-writes design), and `current_role` must stay security-definer + authenticated-callable to avoid the RLS self-recursion the spec calls out; it's read-only and returns only the caller's own role. Not bugs. ✓

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** Security posture — anon has zero surface (no table grant, no function grant, no policy); authenticated surface is exactly the matrix + the 4 RPCs + the role helper. Clean.

**What I tried:** read both migration files; `has_function_privilege` for anon/authenticated on the RPCs + `current_role`; `get_advisors(security)` re-run (5 accepted WARNs, nothing else).

**Open flags (cumulative):** ⑫ ✅ CLOSED. ⑪ rename (OWNER DIRECTIVE, OPEN) — after the rename these 5 WARNs simply reappear under the new name, still accepted.

**Next-commit suggestion:** the ⑪ rename.

---

## Review of 0ceffe1 — feat(supabase): M1.7 — seed Zebronics brand + 42 products

**Verdict:** ✅ accept — a faithful, idempotent seed; verified row-by-row against the CSV source of truth, not by trusting the message.

**Phase / commit goal (as I understood it):** Seed the Zebronics brand + all 42 catalog products from `data/ZebronicsPriceList.csv` per seed-data.md's transformation rules.

**What works — verified live against the CSV:**
- **Counts exact:** 42 products (42 distinct SKUs), 34 priced / 8 unpriced, `min/max price_paise = 6000 / 913800` (₹60 / ₹9,138), 1 brand. Category split **4/6/6/7/5/14** (Adaptors/Adaptors-with-Cable/Charging-Cables/Earphones/Power-Banks/Speakers) — matches the CSV. ✓
- **Gap numbering correct** (the subtle part): Earphones run `ZEB-EAR-01…07` with `EAR-05`/`EAR-06` = NULL (unpriced hold their slots) and `EAR-07` priced (₹219) — not renumbered. The 8 NULLs sit at exactly `EAR-05/06, PWR-02/05, SPK-10/12/13/14`, matching my mechanical regeneration back at 6a1573c. ✓✓
- **Verbatim names incl. the stress cases:** `ASTRA 40 BLACK` = `ZEB-SPK-04`, name `SPK-PSPK 44 PORTABLE BTH SPEAKER (ASTRA 40 BLACK)`, ₹1,029 (feeds the ₹4,478 worked order); typos preserved (Balck/Bannk/Lighting → 3 rows); doubled-space rows (CBL-01, CBL-04) collapsed. ✓
- **Idempotent:** `insert … on conflict (sku) do update` — re-running is a no-op upsert onto identical values. ✓
- SKU scheme `^ZEB-(ADP|AWC|CBL|EAR|PWR|SPK)-\d{2}$` holds across all 42. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- The message notes the drift-protected `scripts/seed.ts` loader (seed-data.md's re-run guard) is deferred until the Node app is scaffolded — reasonable, since a first load into an empty table has no drift to guard against. But log it: **when the app lands, the `--force-prices`/drift-warn loader is still owed**, or future price edits made in-DB could be silently clobbered by a re-seed. Carrying as flag ⑬.

**Domain / correctness checks:** Catalog integrity — **PASSED** (42 SKUs, prices, categories, gap numbering, verbatim names all match the CSV) ✓. This satisfies the bulk of my M2 post-seed obligation early. Money — whole-rupee ×100 → paise, all integers ✓.

**What I tried:** read the seed migration; live queries for distinct-SKU count, ASTRA/min/max rows, the full Earphone SKU→price sequence (gap check), typo-row count, and the category/price/null aggregates — all cross-checked against seed-data.md + the CSV.

**Open flags (cumulative):** ⑪ `current_role` → `auth_profile_role` rename (OWNER DIRECTIVE, OPEN — the one thing owed before this milestone is clean). ⑬ (new, minor) drift-protected seed loader deferred to app-scaffold. ⑩/⑫ closed.

**Next-commit suggestion:** the ⑪ rename migration (owner-directed), then app scaffolding. On the next order-bearing work I'll re-run the snapshot/idempotency/guard suite *through* the RLS wall with the renamed helper.

---

## Review of 6923b61 — fix(supabase): M1.8 — rename current_role() -> auth_profile_role() (owner directive)

**Verdict:** ✅ accept — closes flag ⑪ (owner directive). Rename is complete and the RLS wall + RPCs still enforce, verified live.

**Phase / commit goal (as I understood it):** Execute the owner-directed rename of the reserved-keyword-shadowing helper `current_role()` → `auth_profile_role()`, repointing every call site.

**What works — verified by execution against the live project:**
- **The clever part is correct and proven.** The migration uses `alter function public.current_role() rename to auth_profile_role` and does *not* recreate the M1.6 policies — because a policy's `USING`/`WITH CHECK` expression binds to the function's **OID**, not its name, so the 21 policies keep working under the new name untouched. I proved this empirically: as salesman s1, `select count(*) from orders` returned **1** (own order only) — the OID-bound `orders_select_own` policy still filters correctly through the renamed helper. ✓✓
- **Old name fully gone, new name present:** `pg_proc` shows 0 `public.current_role`, 1 `public.auth_profile_role` (`prosecdef=true`, `search_path=public, pg_temp` preserved). ✓
- **All 4 RPC bodies repointed:** `prosrc like '%auth_profile_role()%'` = 4, `like '%public.current_role()%'` = 0. The RPCs were recreated with `CREATE OR REPLACE` (same signatures → OID + `authenticated` EXECUTE grant preserved, no re-GRANT needed). ✓
- **RPC works post-rename:** `submit_order` as s1 returned `total=20000, ref=ORD-2026-1001` — the recreated body resolves `auth_profile_role()` correctly (a broken helper would have raised "not an active profile"). ✓
- **Full RLS re-check still green:** self-promotion blocked (role stayed `salesman`), s2 sees 0 of s1's orders, anon denied. ✓
- **Spec updated:** roles-and-permissions.md:49 now names `auth_profile_role()` with the reserved-keyword rationale inline so it can't be reintroduced. ✓
- The historical migration files (150000/150400/150500/150600) still contain the old name — **correctly left as-is**: they already ran, and 150800 transforms the end state forward (a fresh re-apply still converges, since the rename lands last and policies follow the OID). No history rewrite. ✓

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** RLS matrix — re-verified intact post-rename ✓. RPC role gating / snapshots — helper resolves correctly inside all four ✓. Footgun — eliminated (the reserved-keyword name is gone from every live object).

**What I tried:** `git show` + `git grep current_role` (only historical files + the intended spec line); a live `DO` block asserting function presence/props, RPC-body call sites (`prosrc`), a real `submit_order`, OID-bound policy enforcement (ownership isolation), self-promotion block, and anon denial — rolled back via RAISE, sequence restored.

**Open flags (cumulative):** **⑪ — ✅ CLOSED (verified).** No blocking items remain. Open: ⑦⑧⑨ (minor M0 doc), ⑬ (deferred seed loader).

**Next-commit suggestion:** app scaffolding (M2+), or close the minor M0 doc flags opportunistically.

---

## Review of 5a869d4 — docs: M1 test accounts — record the 3 real test users + role assignment

**Verdict:** ✅ accept — doc is accurate to the live DB; no secrets committed.

**Phase / commit goal (as I understood it):** Record the three real Supabase Auth accounts Mridul created (admin/accountant/salesman) for end-to-end/manual testing, with their role assignments.

**What works — verified live:**
- `public.profiles` holds exactly the three documented rows: **Vikram = admin, Mriddy = accountant, Mridul = salesman, all `active = true`** — matches the doc's table exactly. ✓
- `auth.users` count = `profiles` count = 3, i.e. **the M1.1 `create_profile_for_new_user` trigger auto-provisioned a profile for each real Dashboard-created user** — the provisioning path now confirmed with real accounts, not just my synthetic test rows. ✓
- **No passwords anywhere** in the diff or repo (the commit message claims it; I read the full diff to confirm). The doc points readers to Mridul for credentials. ✓
- The doc correctly characterizes my automated verification: the `set local role authenticated` + simulated `request.jwt.claim.sub` technique already proved the RLS/RPC behavior without real logins; these accounts are for future manual/app-level testing. Accurate. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **Admin bootstrap clarity:** the doc says roles were promoted "via a plain `update public.profiles set role = ...`". That only works from an **elevated context** (Supabase Studio / `service_role`), which bypasses RLS — an *authenticated* user cannot do it, because the M1.6 policies block self-promotion (I verified). Worth a half-sentence so nobody thinks a signed-in user can self-assign a role. (The runbook context implies Studio, so it's a clarity nit, not an error.)
- **Real personal emails are now in a committed file** (mild PII). Fine for a private repo and it's the owner's own call/accounts — just flag if this repo is ever made public. → noting, not a flag.

**Domain / correctness checks:** RLS/auth — the three roles are exactly the matrix's three; bootstrap done via elevated access (correct). No schema/behavior change.

**What I tried:** read the full diff (no credentials present); live query of `profiles` (names/roles/active) and `auth.users`/`profiles` counts vs the doc.

**Open flags (cumulative):** none new. ⑦⑧⑨ (minor M0 doc), ⑬ (deferred) remain; no blocking items.

**Next-commit suggestion:** M2 app scaffolding. My M1 verification is complete — the schema, triggers, RPCs, RLS, seed, and provisioning are all verified against the live project.

---

## Review of 7cc9e4c — docs: park the M1 performance-advisor findings in future-plans.md

**Verdict:** ✅ accept — the parked list is accurate to the live advisor, and deferring these (rather than fixing now) is the correct engineering call. Docs-only.

**Phase / commit goal (as I understood it):** Give the "left alone on purpose" decision for the M1 `get_advisors(performance)` findings a durable home in future-plans.md, with a revisit trigger tied to the Supabase Pro billing decision (PLAN.md open question #5).

**What works — cross-checked against `get_advisors(performance)` I ran myself:**
- **The four categories are all real and correctly described.** (1) `multiple_permissive_policies` — the two split SELECT policies per table (+ profiles UPDATE, retailers INSERT); the doc's example `products_select_salesman` + `products_select_staff` is right. (2) `auth_rls_initplan` — exactly 5 policies re-evaluate `auth.uid()` per row: `profiles_update_self`, `retailers_insert_salesman`, `orders_select_own`, `order_items_select_own`, `order_events_select_own`. (3) `unindexed_foreign_keys` — **exactly the 5 listed**: `order_events.actor_id`, `order_items.product_id`, `orders.processed_by`, `orders.retailer_id`, `retailers.created_by` (the other FKs — orders.salesman_id, order_*.order_id, products.brand_id — *are* covered, so the list is precise, not hand-wavy). (4) `unused_index` — 1 (`orders_status_submitted_idx`), correctly flagged informational/self-resolving.
- **All four are PERFORMANCE-class, none security/correctness/money/state-machine** → none are blocking by my checklist. Parking is entirely appropriate.
- **The defer decision is sound, not lazy.** At D6 scale (1–2 salesmen, <20 orders/day, 42-row `products`) these touch a few dozen rows; and — a point the doc gets right — adding the 5 FK indexes *now* would immediately generate 5 new `unused_index` findings (write overhead for zero read benefit until volume exists). The revisit trigger (Pro upgrade / observed slowness) is the right gate.
- PLAN.md "Unscheduled" pointer updated to list both parked items; the geotag entry above it is untouched. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **Minor cross-reference overreach:** the entry says these were "confirmed harmless … (see the M1.6/M1.6b review blocks in comments.md)." My M1.6/M1.6b blocks covered the **security** advisor (the 5 accepted `authenticated`-executable WARNs) — they did **not** discuss these *performance* findings. This parking doc (reviewed here) is actually their first REVIEWER treatment; I've now confirmed them harmless in *this* block. Tighten the reference to avoid implying a review that didn't mention them.
- "4 findings" is really **4 categories / dozens of individual lint rows** (multiple_permissive_policies alone spans ~7 tables × several roles). Fine as a summary; noting for precision.
- The `auth_rls_initplan` fix (wrap `auth.uid()` as `(select auth.uid())`) is genuinely trivial and best-practice — reasonable to fold into the RLS policies whenever they're next touched, rather than a dedicated pass.

**Domain / correctness checks:** No schema/behavior change (docs only). Security posture unchanged (these are perf, not security). RLS correctness unaffected — the split policies and unwrapped auth calls change *speed*, not *who-sees-what* (already verified at M1.6/M1.8).

**What I tried:** `git show` the diff; `get_advisors(performance)` on the live project and matched every parked item to the actual lint rows (FK list exact; auth_rls_initplan = 5 policies; unused_index = orders_status_submitted_idx).

**Open flags (cumulative):** No blocking items. ⑦⑧⑨ (minor M0 doc) open; ⑬ (deferred seed loader); **⑭ (new) RLS/index performance pass — parked in future-plans.md, deferred by design** (tracked, not owed). Note ⑧ still open — this commit adds a *performance* entry to future-plans.md, not the Payments-tab entry the design spec references.

**Next-commit suggestion:** M2 app scaffolding.

---

## Review of 3496c17 — docs: D8 — hide self-cancelled orders from the salesman's own list

**Verdict:** ✅ accept — sound, well-documented decision that correctly needs no migration. One substantive **design gap to resolve before the list screen is built** (non-blocking now, since nothing is implemented).

**Phase / commit goal (as I understood it):** Record owner decision D8 — the salesman's own order list hides `status = 'cancelled'` by default (a self-cancel reads as "never happened"), as a client-query filter, not an RLS/schema change; park the "un-hide" view in future-plans.

**What works:**
- **The "no migration needed" claim is correct — verified against what M1 actually built.** `orders.status` carries `'cancelled'`; `cancel_order` sets it (I exercised this in the M1.5 test); the `orders_select_own` RLS policy already returns *all* of a salesman's own rows including cancelled — so a client-side `status != 'cancelled'` filter sits cleanly on top without touching RLS, the row, or the audit trail. Accountant/admin SELECT-all is untouched. ✓
- Correctly keeps the cancel **soft** (row + `order_events` survive) — consistent with data-model.md and the derived-lock lifecycle. No conflict with the state machine.
- Clean docs hygiene: D8 follows the D1–D7 context/decision/consequences format; salesman-app.md updated; the un-hide screen parked in future-plans.md; PLAN.md Unscheduled pointer now lists all three parked items. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **⑮ (design gap) — "self-cancelled" (title/rationale) vs `status != 'cancelled'` (mechanism) are not the same set.** The filter also hides orders an **accountant/admin** cancelled. `cancel_order` lets accountant/admin cancel a salesman's *submitted* order (with a reason) — I verified that path exists in M1.5. Under D8's blanket `status != 'cancelled'`, the salesman who submitted that order would see it **silently vanish** from their list, with no signal the office killed it — risking "where did my order go?" confusion or a duplicate re-submit. The rationale ("almost always a fat-finger self-correction") only holds for *self*-cancels. **Resolve before the list screen ships:** either (a) confirm hiding office-cancels from the salesman is intended (and say so in D8's consequences), or (b) scope the filter to self-cancels only — which needs the cancelling **actor** (from `order_events`/a "cancelled_by" signal), not `status` alone, so it's slightly more than a one-line filter. Flag this now so it's decided, not discovered at implementation.
- **Minor consistency:** the same salesman-app.md section still enumerates `Cancelled` in its "Status chips" list for this screen, one line above the D8 rule that hides cancelled rows from it. A cancelled chip would only ever appear on the S7 detail screen (post-cancel) or a future un-hide view — worth a half-sentence so the chip list and the hide-rule don't read as contradictory.

**Domain / correctness checks:** State machine / soft-cancel / audit trail — unaffected (query-shape only) ✓. RLS — unchanged; salesman retains DB-level access to their own cancelled rows (so the detail screen + any future un-hide view work without a policy change) ✓. Accountant visibility — full, unaffected ✓.

**What I tried:** read the full diff (decisions.md / salesman-app.md / future-plans.md / PLAN.md); cross-checked the "no migration" claim against the M1 objects I already verified live (`cancel_order` behavior, `orders.status` CHECK, `orders_select_own` policy) and against `cancel_order`'s accountant/admin-cancel path (the basis for the ⑮ gap).

**Open flags (cumulative):** No blocking items. **⑮ (new) self-cancel vs office-cancel filter scope** — decide before the salesman order-list screen (M4). ⑦⑧⑨ (minor M0 doc); ⑬ (deferred seed loader); ⑭ (parked perf pass). **⑧ still open** — future-plans.md now has geotag + perf-pass + cancelled-orders-view, but still no Payments entry the design spec points at.

**Next-commit suggestion:** M2 app scaffolding.

---

## Review of a6ec10a — fix(supabase): M1.9 — orders.cancelled_by; correct D8 to self-cancel-only

**Verdict:** ✅ accept — resolves ⑮ correctly (the option-(b) scope-to-self path), verified by execution. Honest about the reversed "no migration" claim.

**Phase / commit goal (as I understood it):** Add `orders.cancelled_by` so the D8 list-hide can distinguish a self-cancel from an office-cancel, correct D8 accordingly, and fix the chip-list contradiction I flagged.

**What works — proven live, self-rolling-back transaction under real salesman + accountant JWTs:**
- **Column added as specced:** `orders.cancelled_by uuid` (nullable, FK → profiles), mirroring `processed_by`. `information_schema` confirms nullable=YES. ✓
- **`cancel_order` records the actor correctly:** salesman self-cancel → `cancelled_by = salesman` (`by_self=t`); accountant office-cancel → `cancelled_by = accountant`, **not** the salesman (`by_acct=t, by_salesman=f`). The two cases are now distinguishable by column, no `order_events` join needed. ✓✓
- **The corrected D8 filter behaves exactly right:** as salesman s1, `... where not (status='cancelled' and cancelled_by = salesman_id)` returned **only the office-cancelled order** (`ORD-2026-1002`) and hid the self-cancelled one (`ORD-2026-1001`) — while the unfiltered RLS query still returned **both** (so the salesman retains DB access; the hide is purely client-query). This is the precise ⑮ resolution. ✓✓✓
- **`cancel_order` recreated cleanly:** `security definer` + `search_path` preserved; `authenticated` retained EXECUTE (I called it as two different authenticated users successfully). Rest of the RPC body unchanged from M1.5/M1.8. ✓
- **Chip contradiction (my minor note) fixed:** salesman-app.md now says the `Cancelled` chip only appears for office-cancels; self-cancels aren't in the list, so no contradiction. ✓
- **data-model.md** orders DDL + RPC table updated to match; **D8** corrected with an honest consequence note ("the original 'no migration needed' claim undersold the design gap the REVIEWER caught"). Good log hygiene. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **New unindexed FK:** `orders.cancelled_by` has no covering index → it joins the ⑭ parked performance bucket (now **6** unindexed FKs, not 5). Same deferral rationale applies; no action now. Just keeping the parked list honest.
- **⑯ (new, config) `auth_leaked_password_protection` is disabled** — the security advisor now surfaces this (a Supabase Auth Dashboard toggle: check new passwords against HaveIBeenPwned). Not a migration/code concern and the BUILDER noted it, but it has no durable home — enable it in the Auth settings before pilot (one click, free hardening). Low urgency for admin-set-password accounts, but worth doing.
- Cosmetic: **two commits are both numbered "M1.9"** (this one and the earlier test-accounts doc `5a869d4`). Harmless, but the sequence now has a duplicate label.

**Domain / correctness checks:** State machine / soft-cancel / audit trail — unchanged (still soft; `order_events` still records the cancel) ✓. RLS — unchanged; the new column is row-scoped-visible automatically (SELECT policies aren't column-scoped) ✓. D8 filter — now matches its own rationale, verified ✓. Money/numbering — untouched.

**What I tried:** `git show`; a live `DO` block — 2 orders submitted by a salesman, one self-cancelled, one accountant-cancelled, asserting `cancelled_by` per case and running the corrected D8 filter (shows office-cancel only, hides self-cancel, RLS still returns both); `get_advisors(security)` (5 accepted WARNs unchanged + the leaked-password Auth notice).

**Open flags (cumulative):** **⑮ — ✅ CLOSED (verified).** No blocking items. ⑯ (new, config) enable leaked-password protection pre-pilot. ⑦⑧⑨ (minor M0 doc); ⑬ (deferred seed loader); ⑭ (parked perf pass, now 6 FKs). ⑧ still open (no Payments entry in future-plans.md).

**Next-commit suggestion:** the Next.js app scaffold (the pending ⬜ half of PLAN's M1 — see the 1062a79 correction below), then auth wiring (M3 login).

---

## Review of 1062a79 — docs: mark M0/M1-backend/M2 complete in PLAN; archive M1 Supabase builder prompt

**Verdict:** ✅ accept — the milestone status is honest and, on the substance, accurate (it does **not** overclaim — M1 and M3 are marked *partial*, not done). One minor doc-accuracy flag: the migration tally is off by one.

**Phase / commit goal (as I understood it):** Add a Status column to the PLAN.md milestones table reflecting reality after the M1 backend, and record the builder prompt that drove M1.

**What works — each status claim checked literally:**
- **M0 ✅** "approved by Mridul 2026-07-06 (c82607e)" — matches the commit I reviewed and the recorded owner approval. ✓
- **M1 ◑ Backend ✅ · app ⬜** — correctly **partial**. The Next.js app scaffold genuinely isn't started; the backend (schema/RPCs/triggers/RLS/seed/provisioning) is live and reviewer-verified. Honest, doesn't claim M1 done. ✓
- **M2 ✅ Data done** — 42 products, salesman sees 34, checks pass (M1.7) — I verified this against the CSV. The deferred `scripts/seed.ts` loader is correctly still flagged (⑬). ✓
- **M3 ◑ DB-side ✅ · login UI ⬜** — provisioning trigger + RLS-per-role verified, 3 test accounts exist, login flow pending. Accurate. ✓
- **M4/M5/M6 ⬜** — accurate. ✓
- **This corrects my own imprecision:** I'd been writing "next: M2 app scaffolding," but PLAN's **M1** is "Scaffold + schema" (the Next.js app is M1's pending half) and **M2** is "Seed." The app scaffold is the ⬜ part of M1, not M2. The new Status column makes the true shape clear — good.
- Builder prompt recorded ([Prompts/supabase-setup-builder-prompt.md](Prompts/supabase-setup-builder-prompt.md)) — accurate provenance of the M1 handoff; it still says `current_role()` (pre-M1.8), correctly preserved as a historical artifact, not retro-edited. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **Migration count off by one.** The M1 status cell reads "**10 migrations** live & reviewer-verified (**M1.1–M1.8**)" — but there are **11** migration files (`git ls-files supabase/migrations/` = 11); `20260706T150900_orders_cancelled_by.sql` (M1.9, a6ec10a — reviewer-verified) is live and omitted. Fix to "**11 migrations (M1.1–M1.9)**". (My log verifies claims literally; this is exactly that kind of drift.)
- The "Verified-complete detail … remaining flags (⑬ loader, ⑭ performance pass)" callout names only two open flags — ⑦⑧⑨ (M0 doc) and ⑯ (leaked-password) also remain. Fine as illustrative, but "see the ledger for the full list" would be truer.
- Subject says "archive … builder prompt," but the file is added to `Prompts/`, not moved to `archive/`. Cosmetic wording.

**Domain / correctness checks:** No schema/behavior/spec change — PLAN status + a recorded prompt. Nothing to execute. Milestone claims cross-checked against the live DB state and my prior verified reviews (all consistent except the count).

**What I tried:** read the full diff; `git ls-files supabase/migrations/` → 11 files (vs the "10 / M1.1–M1.8" claim); cross-checked each milestone's Status cell against what I've verified live (M0 approval, M1 backend objects, M2 seed counts, M3 provisioning + test accounts).

**Open flags (cumulative):** No blocking items. Doc-accuracy: migration count (11, not 10) — trivial, fix opportunistically (not ledgered). ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password toggle) remain — all non-blocking.

**Next-commit suggestion:** the Next.js app scaffold — the pending half of M1 — then M3 login wiring. When the app lands, my deferred obligations activate: the `scripts/seed.ts` drift-guard (⑬) and end-to-end auth/RLS through the real client with the 3 test accounts.

---

## Review of 77b5a32 — docs: fix migration count in PLAN.md status (11, not 10)

**Verdict:** ✅ accept — closes both non-blocking notes from my 1062a79 review. Trivial doc fix, verified.

**What works:**
- "10 migrations (M1.1–M1.8)" → "**11 migrations (M1.1–M1.9)**" — matches `git ls-files supabase/migrations/` (= 11) exactly. ✓
- The ledger callout loosened from naming only ⑬/⑭ to "**see the ledger for the full non-blocking/deferred list**" — my second note, and it pre-empts the same staleness recurring as new flags open. Good call. ✓
- One file, two hunks, nothing else touched.

**Blocking issues:** None. **Non-blocking suggestions:** None.

**What I tried:** read the diff; re-counted `git ls-files supabase/migrations/` = 11 against the new text.

**Open flags (cumulative):** No blocking items. ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password toggle) — all non-blocking.

**Next-commit suggestion:** the Next.js app scaffold (finishing M1).

---

## Review of 54a3171 — feat(app): scaffold Next.js (App Router, TypeScript, ESLint)

**Verdict:** ✅ accept — clean, standard scaffold; `next build` + TypeScript verified green by execution, app code is lint-clean. One non-blocking finding: `npm run lint` currently **fails**, but entirely on the frozen design artifact, not app code.

**Phase / commit goal (as I understood it):** Stand up the bare Next.js app (App Router, `src/app`, TypeScript, ESLint, no Tailwind) on top of the finished backend — the pending half of M1.

**What works — verified by execution, not by reading:**
- **`npm run build` is clean** (I ran it): Next 16.2.10 / Turbopack, `✓ Compiled successfully`, TypeScript passed, 3/3 static pages, routes `/` + `/_not-found`. The commit's "build verified clean" is literally true. ✓
- **App code is lint-clean:** every ESLint issue is in `design/phase1/support.js`; **zero** in `src/`. ✓
- **Sane, current setup:** Next 16.2.10 + React 19.2.4, App Router under `src/app`, `tsconfig` `strict` + `@/* → ./src/*`, ESLint 9 flat config (`core-web-vitals` + `typescript`). ✓
- **Right dependency choice for what's coming:** `@supabase/ssr` + `@supabase/supabase-js` — the correct cookie-session pair for App-Router auth (staged, not yet wired). ✓
- **Secret hygiene is correct:** `.gitignore` already covered `.env`/`.env.*` (with `!.env.example`), `node_modules`, `.next`, `.vercel`; the commit adds only `next-env.d.ts` (Next regenerates it). The untracked `.env.example` holds **empty placeholders** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — no secrets; the build reads `.env.local` (gitignored, uncommitted) for the real keys. Both are `NEXT_PUBLIC_` (the publishable/anon key is client-safe — protected by the RLS I verified); no `service_role` in the example. ✓
- **Honest commit message:** documents the create-next-app-into-temp-then-merge approach, what was/wasn't copied, and that the existing `.gitignore`/README were kept. No overclaim (it says *build* clean, not *lint* clean). ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **⑰ `npm run lint` fails (exit 1: 2 errors, 8 warnings) — all in `design/phase1/support.js`, the frozen generated Claude Design runtime ("GENERATED … do not edit"), not app source.** `src/` is clean. This will red-light any CI/Vercel lint gate the moment one's wired, and misleads a fresh dev running `npm run lint`. One-line fix: add `design/**` (or at least `design/phase1/support.js`) to `globalIgnores` in `eslint.config.mjs` — the design deliverable isn't app code and shouldn't be linted.
- **Scaffold placeholders to replace next (BUILDER already flagged this):** `layout.tsx` uses Geist/Geist_Mono and `globals.css` uses the default `--background/--foreground` tokens — but the design spec mandates **Space Grotesk + JetBrains Mono** and the instrument tokens (`#1D4ED8`, `#B45309`, `#14181F`, …) with the font-loading mandate (subset + `font-display: swap` + system fallback stacks — deviation #2). Expected in the next commit; I'll verify the tokens/fonts land per spec then.

**Domain / correctness checks:** N/A (scaffold — no data/logic yet). Build/type/lint exercised directly.

**What I tried:** read `package.json` / `tsconfig` / `next.config` / `eslint.config` / `layout.tsx` / `page.tsx` / `globals.css`; `npm install` (up to date); `npm run build` (clean, verified); `npm run lint` (exit 1 — all 10 problems in `design/phase1/support.js`, `src/` clean); inspected `.env.example` (empty placeholders, no secrets).

**Open flags (cumulative):** No blocking items. **⑰ (new) `npm run lint` fails on the frozen design artifact — ignore `design/`.** ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain.

**Next-commit suggestion:** the instrument design tokens + fonts (replacing the Geist/default scaffold), and the ⑰ lint-ignore; then the Supabase browser/server clients + login (M3).

---

## Review of dcb3904 — feat(app): Supabase SSR integration + route protection/role routing

**Verdict:** ⚠️ accept-with-followups — the auth **architecture is correct and secure**, but the middleware's redirect branches drop the session cookies, which **breaks the deactivated-user path (infinite redirect loop) and causes intermittent logouts**. That fix is **blocking for the next commit** (before the login flow is exercised). ⑰ is closed.

**Phase / commit goal (as I understood it):** Wire Supabase SSR — browser/server clients, generated DB types, and middleware (`proxy.ts`) that gates auth, fails closed on inactive/missing profiles, and routes by role.

**What works — and much of this is genuinely well done:**
- **`getUser()`, not `getSession()`, is the only server-side gate** ([middleware.ts:38](src/lib/supabase/middleware.ts#L38)) — with a comment explaining it revalidates against the Auth server. This is *the* correct SSR practice and avoids the #1 spoofable-cookie pitfall. ✓✓
- **Fail-closed on inactive/missing profile:** `role = profile?.active ? profile.role : null`; if null → `signOut()` + `/login?reason=deactivated`, never renders a shell. I traced the RLS interaction: an inactive user's `profiles` SELECT returns 0 rows (the `auth_profile_role() is not null` policy denies them), so `maybeSingle()` → null → fail closed. Double-guarded. ✓
- **Next.js 16 `proxy.ts` / `export function proxy` convention** — correctly identified (the scaffold warned middleware.ts is deprecated) and verified against Vercel docs rather than guessed. ✓
- **Precise territory checks** — `pathname === "/dashboard" || startsWith("/dashboard/")` vs `pathname === "/"`, explicitly avoiding a `startsWith("/")` that would catch everything. ✓
- **Types generated from the live project** ([database.types.ts](src/lib/types/database.types.ts)) — includes `cancelled_by` (post-M1.9), the 4 RPCs, and `auth_profile_role`; both clients are `Database`-typed. ✓
- **⑰ CLOSED:** `design/**` + `archive/**` added to eslint `globalIgnores`; I verified `npm run lint` now exits **0**. ✓
- Build verified clean; `.env.example` committed (empty placeholders); commit message honestly notes "auth_profile_role() is UI convenience only — RLS remains the wall." ✓

**Blocking issue — must fix in the next commit (before login is wired):**
- **The middleware's redirect responses don't carry `supabaseResponse`'s cookies.** Every authenticated redirect branch returns a *fresh* `NextResponse.redirect(url)` ([:59, :75, :80 in middleware.ts](src/lib/supabase/middleware.ts)) that never copies the cookies the `setAll` adapter accumulated on `supabaseResponse`. The @supabase/ssr contract is explicit: when you return a new response, you **must** copy those cookies, or the session terminates prematurely. Two concrete failures:
  1. **Deactivated / no-profile user → infinite redirect loop.** The `!role` branch calls `signOut()` (which writes cookie-*clears* onto `supabaseResponse`) then returns a redirect that **drops those clears** → the browser keeps its auth cookies → on the redirected `/login` request, `getUser()` still returns the user, the `!role` check fires *again* (it runs before the `isLoginRoute` guard), signs out, redirects to `/login` again → `ERR_TOO_MANY_REDIRECTS`. A deactivated salesman gets a browser redirect-loop error instead of the intended "account deactivated" login screen. (Not a security hole — they're still denied — but the deactivate path is broken.)
  2. **Intermittent logouts for everyone.** When `getUser()` refreshes a near-expiry token, the new cookies land on `supabaseResponse`; the `isLoginRoute` bounce and `wrongTerritory` bounce drop them → the browser keeps stale tokens → premature logout. This directly undermines the app's "remember me ~30 days, don't make the field salesman re-login" goal.
  - **Fix:** for each redirect in an authenticated branch, copy the cookies, e.g. `const res = NextResponse.redirect(url); supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c)); return res;`. (The `!user` branch is fine — no session to preserve, matching Supabase's own example.) This is a code-contract finding (verified against the documented @supabase/ssr requirement + Next response semantics), not a runtime repro — reproducing needs a token-refresh-coincident redirect / a live deactivated session.

**Non-blocking suggestions:**
- **Two network round-trips per navigation** — `getUser()` (Auth server) + a `profiles` query (DB) on every matched request. Correct for security, but on the spotty-connectivity persona it adds latency to each navigation; consider caching the role (JWT `app_metadata` claim, or a short-lived signed cookie) later. Ties into the ⑭ perf theme.
- **Territory gating is coarse** — only `/` vs `/dashboard*` are role-guarded; other future routes fall through (authenticated+active only). Fine given RLS is the data wall, but worth remembering when finer per-route roles appear.

**Domain / correctness checks:** Auth/RLS — gating is correct and fail-closed (getUser + active check) ✓; the actual data wall is still RLS (verified in M1) ✓. Session persistence — **defective** (the cookie-copy bug above). No money/state-machine surface here.

**What I tried:** read all six files; `npm run build` (clean, Proxy registered) and `npm run lint` (exit 0 — ⑰ closed); traced the RLS interaction of the middleware `profiles` query (fail-closed confirmed); analysed the redirect/cookie flow against the @supabase/ssr contract (the blocking finding). Reviewed against the *committed* tree (the working dir has uncommitted next-commit WIP: globals.css/layout.tsx edits, icon/manifest/components — not part of this commit).

**Open flags (cumulative):** **⑰ — ✅ CLOSED (lint exit 0).** **⑱ (new, BLOCKING-next) middleware redirect cookie-drop** — deactivated loop + intermittent logouts; fix before the login flow. ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain — non-blocking.

**Next-commit suggestion:** fix ⑱ (copy cookies onto the authenticated redirects) as part of, or before, the login page + sign-in action — otherwise the first real deactivated login and any refresh-time bounce will misbehave.

---

## Review of 7f65371 — feat(app): design system foundation — fonts, tokens, primitives, app mark

**Verdict:** ✅ accept — faithful, well-built instrument-grammar foundation. One non-blocking finding: a self-referential font CSS variable that's fragile (may silently drop Space Grotesk depending on CSS load order).

**Phase / commit goal (as I understood it):** Replace the scaffold's Geist/default-token placeholders with the real instrument grammar — tokens, the two typefaces, the receipt-glyph app icons, and the first UI primitives.

**What works — checked against design/phase1-design-spec.md §2:**
- **Color tokens are exact:** accent `#1d4ed8`, amber `#b45309`, locked `#6b7580`, processed `#15803d`, error `#b91c1c`, ink `#14181f`, paper `#f2f3f5`, inactive `#8a94a0` — all match the spec table; plus a sensible `--color-hairline #d8dbdf` (the spec left the hairline hex unspecified). Type scale (21/700, 15/600, 13/500, 10px+0.08em), `--radius: 2px`, `--touch-target-min: 48px` all per spec. Light-theme-only (dark-mode block removed, with a comment). ✓
- **Fonts via `next/font`** ([layout.tsx](src/app/layout.tsx)): Space Grotesk (structure) + JetBrains Mono (figures), which self-hosts + subsets + sets `font-display: swap`, with explicit `fallback` stacks — satisfying design-spec **deviation #2** (subset + swap + system fallback so first paint never blocks). The comment even cites it. ✓
- **App mark = the receipt glyph, byte-verified:** `src/app/icon.png` and `apple-icon.png` sha = `39d6ec0…` = **the approved `assets/favicon.png`**; `public/icon-maskable.png` is a distinct padded variant. `manifest.ts`: `theme_color #14181F` (ink), `background_color #F2F3F5` (paper), `standalone`, both icons wired (any + maskable). Matches deviation #6 exactly. ✓
- **Primitives are spec-faithful and accessible:** `Button` (5 variants mapping to the spec's Primary/Secondary/Destructive/filled-Destructive/Print-ink taxonomy; `loading` + `aria-busy` + disabled). `StatusTag` (flat tag + leading 8px square + mono, 5 tones, comment reaffirms "Chip = status"). `Field` (hairline + 2px radius, `aria-invalid`/`aria-describedby` error wiring, `useId`, and the mono SHOW/HIDE password toggle the S1 login screen calls for). ✓
- **Build + lint both exit 0** (I ran them). ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **⑲ Self-referential font variable.** [globals.css](src/app/globals.css) declares `--font-structure: var(--font-structure), system-ui, sans-serif` (and the same for `--font-figures`) — but `next/font` already assigns `--font-structure` the font stack. I confirmed in the compiled CSS that **both** declarations ship: `.space_grotesk_…_variable{--font-structure:"Space Grotesk", system-ui, sans-serif}` (class, specificity 0,1,0) **and** `:root{…--font-structure:var(--font-structure), system-ui, sans-serif…}` (also 0,1,0), both on `<html>`. Equal specificity → the winner is decided by chunk load order; if the `:root` rule wins, `--font-structure` is a **cycle** (guaranteed-invalid), and `font-family: var(--font-structure)` falls back to the browser default — silently dropping Space Grotesk. It may render correctly in this build, but it's fragile and the `, system-ui, sans-serif` fallback is redundant (next/font's `fallback` option already provides one). **Fix:** give next/font a distinct name (`variable: "--font-space-grotesk"`) and set `--font-structure: var(--font-space-grotesk), system-ui, sans-serif`, or drop the globals redeclaration and use next/font's variable directly. (I verified the cycle statically in the compiled CSS; the exact visual outcome is load-order-dependent — a browser computed-style check on a text-heavy screen would settle it, which is worth doing once the login screen exists.)

**Domain / correctness checks:** Design-grammar fidelity — tokens/type/radius/touch-target/light-only all per spec ✓; receipt-glyph mark per deviation #6 ✓; font-loading mandate (deviation #2) met via next/font ✓ (subject to ⑲). No data/logic surface.

**What I tried:** read globals.css / layout.tsx / manifest.ts / the three primitives; `shasum` on the icons vs `assets/favicon.png` (identical receipt glyph); `npm run build` (exit 0) + `npm run lint` (exit 0); grepped the compiled `.next` CSS to confirm the `--font-structure` cycle survives to output with equal specificity.

**Open flags (cumulative):** ⑱ (BLOCKING — fixed in 0dc60a3, reviewed next). **⑲ (new, non-blocking) self-referential font var — fix with distinct names.** ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain.

**Next-commit suggestion:** the ⑱ cookie fix landed as 0dc60a3 (next). Then the S1 login screen (which will exercise these primitives + the auth flow end-to-end — where I'll also settle ⑲ with a real rendered check).

---

## Review of 0dc60a3 — fix(app): M1.9-app — middleware redirect cookie-drop (blocking, flag 18)

**Verdict:** ✅ accept — closes the ⑱ blocker exactly as the @supabase/ssr contract requires. Build + lint clean.

**Phase / commit goal (as I understood it):** Fix the middleware redirect branches so session-cookie mutations (refreshed tokens, `signOut()` clears) aren't dropped — killing the deactivated-user redirect loop and the intermittent refresh logouts.

**What works — verified:**
- **`redirectWithCookies(url)` helper** creates the redirect then copies `supabaseResponse.cookies.getAll()` onto it before returning — precisely the documented fix I recommended. ✓
- **All four redirect call sites now route through it** — confirmed by grep: `return redirectWithCookies(url)` at lines 61/79/88/99, and **zero** bare `return NextResponse.redirect(...)` left. Routing the `!user` branch through it too (not strictly required) removes the asymmetry — a clean choice. ✓
- **This resolves both failures I traced:** the deactivated path now carries `signOut()`'s cookie-clears → the browser drops its auth cookies → the redirected `/login` request has no user → falls through to the login page (no loop); and a token-refresh bounce now carries the rotated cookies → no premature logout. ✓
- **30-day `cookieOptions` wired** ([cookie-options.ts](src/lib/supabase/cookie-options.ts)) and shared across browser/server/middleware clients — implements S1's "Keep me signed in ~30 DAYS" default; the commit **honestly notes** the login checkbox is currently UI-only, so it isn't mistaken for a wired session-vs-persistent toggle. ✓
- `npm run build` exit 0, `npm run lint` exit 0 (I ran both at this commit). ✓

**Blocking issues:** None — ⑱ is closed.

**Non-blocking suggestions:**
- **Remember-me is now always-on** (30-day maxAge applied globally); the S1 "uncheck → session-only" path isn't wired. The BUILDER flagged this; fine for the foundation, worth wiring when the login form's checkbox becomes functional.
- Minor: partial `cookieOptions` (just `maxAge`) merges with @supabase/ssr's secure/sameSite/httpOnly-less defaults (auth cookies are intentionally JS-readable) — standard library behavior, so `secure`/`sameSite=lax` are preserved; no action, just noting I considered it.

**Domain / correctness checks:** Auth/session — the cookie-propagation contract is now honored on every exit path; getUser gating + fail-closed (from dcb3904) unchanged. No data/money surface. (Fix is code-verified against the @supabase/ssr contract + the exact failure I described; a live loop-resolution repro would need a deactivated session in a browser.)

**What I tried:** read the full diff; grep of `middleware.ts` (4× `redirectWithCookies`, 0 bare redirects); `git merge-base --is-ancestor` to confirm the fix is in HEAD; `npm run build`/`npm run lint` (both exit 0).

**Open flags (cumulative):** **⑱ — ✅ CLOSED.** No blocking items. ⑲ (font var), ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) — all non-blocking.

**Next-commit suggestion:** the S1 login screen + sign-in Server Action — the first end-to-end exercise of the auth flow (getUser gating, the redirect cookies, role routing) and the primitives; I'll drive it with the 3 real test accounts and settle ⑲ with a rendered-font check.

---

## Review of 345dce2 — feat(app): S1 Login screen (full) + fix self-referential font var (flag 19)

**Verdict:** ✅ accept — S1 is spec-faithful and renders; ⑲ is fixed and verified in the served output. Two minor non-blocking notes.

**Phase / commit goal (as I understood it):** Build the S1 login screen (mark, form, remember-me, footer, deactivated strip) wired to `signInWithPassword` + proxy role-routing, and fix the ⑲ font cycle.

**What works — verified by execution (prerendered HTML + served CSS, not just reading):**
- **⑲ CLOSED, confirmed in output:** `next/font` now uses distinct names (`--font-space-grotesk` / `--font-jetbrains-mono`); globals' semantic tokens reference *those* (`--font-structure: var(--font-space-grotesk), …`). The served CSS reads `font-structure:var(--font-space-grotesk)` (no self-reference) and `<html>` carries both `…_variable` classes — so Space Grotesk actually applies. The canonical create-next-app pattern; cycle gone. ✓
- **S1 renders** (`/login` prerenders ○ static): the prerendered HTML contains "Ganpati Enterprises", "ORDER CAPTURE", "FIELD SALES", the footer "Call the office to reset it.", and the **receipt-glyph mark** (`/icon.png`) — i.e. the code correctly follows **deviation #6** (receipt glyph in the S1 block), not the stale "GE monogram" body text. That resolves the *code* half of ⑨ (the spec-doc text is still unreconciled — ⑨ stays open for the doc). ✓
- **Form is spec-faithful** ([LoginForm.tsx](src/app/login/LoginForm.tsx)): `Field` primitives (email/password with autoComplete + the mono SHOW toggle), remember-me **checked by default**, `Button` with `loading`, the `?reason=deactivated` strip ("This account has been deactivated. Call the office."), a **generic** "Wrong email or password." (no user-enumeration leak), then `signInWithPassword` → `router.push("/")` + `refresh()` letting the ⑱-fixed proxy role-route. Client-side sign-in (a valid alternative to a Server Action; the browser client persists the session cookies the middleware reads). ✓
- **`<Suspense>` around `LoginForm`** is required (it calls `useSearchParams`) and correctly present — avoids the build-time bailout error. ✓
- build + lint exit 0. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **Blank-form flash on slow 4G.** Because `LoginForm` reads `useSearchParams` under `<Suspense fallback={null}>`, the entire form is **client-rendered** — the SSR HTML has the mark/tagline/footer but **no form fields** until the JS bundle hydrates. On the field-salesman's slow connection that's a visible formless beat. Since `useSearchParams` is only used to read `?reason=deactivated`, prefer reading it **server-side** in [page.tsx](src/app/login/page.tsx) (page components receive a `searchParams` prop) and passing `deactivated` as a prop — then `LoginForm` can SSR and the form paints immediately. Login is rare (S1 notes ~monthly), so minor, but it nicks the <2s-on-4G budget the design spec prioritizes.
- **Remember-me is still cosmetic** (carry-forward from 0dc60a3): the checkbox toggles state nobody reads — the 30-day cookie is always applied, so unchecking does nothing. Wire it (session-vs-persistent) when that toggle is implemented, or the UI overpromises.

**Domain / correctness checks:** Design fidelity — mark/tagline/footer/fields per S1, receipt glyph per deviation #6 ✓. Auth flow — client sign-in → cookies → proxy role-route, deactivated wired to the (⑱-fixed) middleware ✓. Could not drive a *real* login end-to-end: the 3 test accounts' passwords aren't committed (correctly), so a live sign-in awaits credentials — the DB/RLS side is already proven (M1), and the client wiring is standard @supabase/ssr.

**What I tried:** read page.tsx / LoginForm.tsx / login.module.css and the font-var diff; `npm run build` (exit 0, `/login` ○ static) + `npm run lint` (exit 0); grepped the **prerendered** `.next/server/app/login.html` for S1 content (present) and the form fields (absent → client-rendered, as analysed); confirmed the served CSS has no font cycle and `<html>` carries the distinct font-variable classes.

**Open flags (cumulative):** **⑲ — ✅ CLOSED (verified in output).** No blocking items. ⑨ (M0 doc — S1 mark code now correct, spec text still says "GE monogram"), ⑦⑧ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain — all non-blocking.

**Next-commit suggestion:** continue the salesman flow (S2 Home / My Orders, or S3 retailer picker), or a real end-to-end login drive once test credentials are available. When a data-reading screen lands I'll re-exercise RLS through the real client.

---

## Review of 32c1c96 — feat(app): S2 salesman Home + S8 accountant/admin Orders shells

**Verdict:** ✅ accept — the first data screens are well-built and the RLS-as-the-wall architecture is correct; `format.ts`/`order-status.ts` verified by execution. One functional gap: S2 doesn't yet apply the D8 self-cancel filter (⑳, non-blocking).

**Phase / commit goal (as I understood it):** S2 (salesman Home/My Orders) + S8 (accountant/admin Orders table), with shared `format.ts` (money/date/countdown), `order-status.ts` (chip derivation), and the OrderCard / BottomTabBar / SignOutButton primitives.

**What works — money/date logic unit-tested by execution:**
- **`formatRupees` is correct incl. en-IN lakh grouping:** 447800→`₹4,478`, 6000→`₹60`, 913800→`₹9,138`, **10258400→`₹1,02,584`**, 0→`₹0`. Whole-rupees (`Math.round(paise/100)`), no paise fractions (D5). ✓
- **`formatCountdown`** minutes-only: +72m→`editable 1h 12m` (not urgent), +8m→`editable 8m` (**urgent**, `<10m`), passed→`null`. Matches spec §2. ✓
- **`formatOrderTimestamp`** IST-correct: today→`11:42`, yesterday→`Yesterday 16:03`, older→`01 Jul 2026, 11:42`, and it **buckets across the IST/UTC boundary correctly** (a `19:00Z` order lands on the next IST day, not "yesterday"). ✓ (15/16 assertions passed; the one miss was *my* test feeding a future-dated order — the code's full-date output was right.)
- **`order-status.ts`** implements the derived-lock model faithfully: cancelled→`Cancelled`/error, processed→`Processed`/processed, submitted→countdown chip (amber if `<10m`, else accent) or `Submitted · locked` once the window passes. "Chip = status," processed/cancelled always show their own chip. Matches the corrected spec. ✓
- **RLS is the wall, not client filtering — both pages get this right.** S2 queries `orders` with **no `.eq('salesman_id')`** and S8 with **no role filter**; each relies on `orders_select_own` vs `orders_select_staff` (which I proved at M1) to return different rows from the *same query shape*. Both have comments stating this explicitly. This is the correct, non-duplicative design. ✓
- **S8 disambiguates the FK correctly:** `profiles!orders_salesman_id_fkey(full_name)` — `orders` has three FKs to `profiles` (salesman/processed_by/cancelled_by), so the explicit hint is required; it's the right one. Ledger columns (REF/SUBMITTED/SALESMAN/RETAILER+NEW/LINES/TOTAL/STATUS), the `NEW` badge on unverified retailers, and mono figures all match S8. ✓
- S2 empty state ("No orders yet — take your first order — tap New Order below"), TODAY/EARLIER IST sections, sign-out, and BottomTabBar per spec. Data pages correctly render **dynamic (ƒ)**. build + lint exit 0. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- **⑳ S2 doesn't apply the D8 self-cancel filter.** The query fetches *all* the salesman's own orders (incl. `cancelled`) and renders them — so a **self-cancelled** order would appear in Home, contradicting D8 (for which `orders.cancelled_by` was added specifically). Confirmed: no `cancelled_by`/status filter in the query. Fix: exclude self-cancels, e.g. `.or('status.neq.cancelled,cancelled_by.neq.<user.id>')` — keeps non-cancelled + office-cancels (per the corrected D8), hides self-cancels. S8 correctly has *no* such filter (accountant sees all). Non-blocking (nothing breaks; the DB supports it), but it's a decided behaviour not yet wired.
- **Account line shows the email, not the name.** S2 spec says "Signed in as **Raju** · Sign out"; the code shows `user?.email`. Prefer the profile's `full_name` (a small extra select, or read it in the layout). Cosmetic.
- Couldn't drive the pages with a *real* logged-in session (test-account passwords aren't committed) — the RLS scoping they depend on is already proven at M1, and the PostgREST query shapes (nested `retailers`/`order_items(count)`, the FK hint) are valid.

**Domain / correctness checks:** Money — integer paise → whole-rupee en-IN, no tax math (D5) ✓, verified. State machine / derived lock — chip derivation matches the lifecycle ✓. RLS — pages rely on it correctly (proven at M1); no client-side ownership filter to drift ✓. D8 — **not yet applied on S2** (⑳). IST — correct across the tz boundary ✓.

**What I tried:** read format.ts / order-status.ts / page.tsx (S2) / dashboard/page.tsx (S8) / OrderCard / BottomTabBar; a `node` TS unit test of `format.ts` (15/16, the miss was a bad expectation); `npm run build` (exit 0; `/` and `/dashboard` are ƒ dynamic) + `npm run lint` (exit 0); grep-confirmed S2 has no D8 filter.

**Open flags (cumulative):** No blocking items. **⑳ (new) S2 missing the D8 self-cancel filter.** ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain — all non-blocking.

**Next-commit suggestion:** wire the D8 filter on S2 (⑳); continue the flow (S3 retailer picker / S4 quick order). A live login drive (with a test credential) would let me confirm role-routing + RLS end-to-end through the browser.

---

## Review of b91a67e — docs: record leaked-password-protection as an owner go-live toggle

**Verdict:** ✅ accept — accurate, correctly scoped; homes ⑯ as an owner action. Docs-only.

**What works:**
- Adds PLAN.md open question **#7** (owner-assigned): enable Supabase Auth's leaked-password / HaveIBeenPwned check. Gives ⑯ a durable home alongside the other go-live toggles. ✓
- The rationale is **correct**: it's a Dashboard-only setting (Authentication → Providers → Email) with **no MCP tool** to toggle it — I confirmed the Supabase MCP surface has no auth-config mutator (same class as creating auth users, which also required the Dashboard). Recording it rather than faking a workaround is the right call. ✓

**Blocking issues:** None. **Non-blocking suggestions:** None.

**What I tried:** read the diff; confirmed against the available Supabase MCP tools that none expose Auth provider/security settings.

**Open flags (cumulative):** No blocking items. ⑯ now homed (PLAN Q#7, owner enables before pilot). ⑳ (S2 D8 filter), ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass) remain — non-blocking.

**Next-commit suggestion:** wire ⑳ (S2 D8 filter) and continue the salesman flow (S3/S4).

---

## Review of fefd9260 — fix(app): S2 — apply D8 self-cancel filter; show full_name not email

**Verdict:** ✅ accept — ⑳ closed; the D8 filter is correct and verified by execution.

**What works:**
- **D8 filter `.or('status.neq.cancelled,cancelled_by.neq.${user.id}')` — verified live.** I set up three of the salesman's own orders (submitted, self-cancelled, office-cancelled) and ran the exact filter (as SQL `status <> 'cancelled' OR cancelled_by <> s1`): it returned **`ORD-…1001(submitted)` + `…1003(OFFICE)`** and **hid `…1002(SELF)`** — precisely the corrected D8 behaviour. It's the De Morgan equivalent of the `NOT(status=cancelled AND cancelled_by=uid)` form I proved at a6ec10a. The commit's own reasoning is exactly right: the first clause covers every non-cancelled order regardless of `cancelled_by`; the second only decides which *cancelled* rows survive (office-cancel stays, self-cancel goes). No NULL edge issue — `cancel_order` always sets `cancelled_by`, so no cancelled row has a null there. ✓
- **full_name fix:** the account line now shows `profile?.full_name ?? user?.email` ("Signed in as Mridul (salesman)"), matching the S2 spec's "Signed in as Raju" wording. ✓
- build + lint exit 0. ✓

**Blocking issues:** None.

**Non-blocking suggestions:**
- S2 now issues three reads per render (getUser + the new `profiles` full_name lookup + orders), and the middleware already fetched role/active for the same user. Fine for now, but caching role+name (JWT claim or passing from the layout) would cut the per-navigation round-trips — ties into the ⑭ perf theme. Minor.

**Domain / correctness checks:** D8 — now correctly applied on S2, verified (self hidden, office visible) ✓. RLS — unchanged (the `.or` is an additional filter *within* the RLS-scoped own rows) ✓. No money/state surface.

**What I tried:** read the diff; `npm run build`/`npm run lint` (both exit 0); a live `DO` block exercising the exact filter over submitted/self-cancel/office-cancel orders under the salesman's RLS context (rolled back; sequence restored).

**Open flags (cumulative):** **⑳ — ✅ CLOSED (verified).** No blocking items. ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password, PLAN Q#7) remain — non-blocking.

**Next-commit suggestion:** continue the salesman flow — S3 (retailer picker) / S4 (quick order, the hero screen), where the write RPCs (`submit_order`) finally get exercised through the app; I'll verify the snapshot/idempotency behaviour end-to-end there.

---

## Review of 39cf779 — feat: D9 — login by username instead of email

**Verdict:** ⚠️ accept-with-followups — username login is cleanly built and works, but D9's core **security claim is disproven by execution** (I harvested a real staff email as `anon`), and the proper fix (service-role lookup, revoke `anon`) should be carried into a near-term commit.

**Phase / commit goal (as I understood it):** Switch login from email to a separately-chosen username: add `profiles.username`, an anon-callable `email_for_username()` RPC, and a Server Action that resolves username→email then signs in.

**What works — verified live:**
- **Feature is functional:** `username citext unique` + a `^[a-zA-Z0-9_.]{3,20}$` format check; `create_profile_for_new_user` now reads `raw_user_meta_data->>'username'`; the 3 test accounts are **backfilled** (`vikram`/`mriddy`/`mridul`, `null_usernames = 0`, citext installed — all confirmed live). ✓
- **Good hygiene:** `email_for_username` is `security definer`, search_path pinned, active-only (deactivated/nonexistent both return NULL); the Server Action uses a **single generic** "Wrong username or password." for every failure (no form-level enumeration); `citext` makes "Raju"/"raju" collide correctly. ✓
- **Nicely resolved my 345dce2 note:** `login/page.tsx` now reads `searchParams` **server-side** and passes `deactivated` as a prop, so `LoginForm` dropped `useSearchParams` — no more `Suspense fallback={null}` blanking the form; the fields now SSR. ✓ Field has `autoCapitalize="none"` + `spellCheck={false}` on username (good mobile UX). ✓
- build + lint exit 0. ✓

**Blocking issues:** None (the disclosure below is real but low-impact for this app).

**Carried followup — the ㉑ security finding (proven):**
- **`email_for_username` is `anon`-executable, so the username→email harvest D9 says it prevents is still wide open.** I called it *as the `anon` role*: `email_for_username('mridul')` → **`mridul289agrawal@gmail.com`**. The security advisor flags it too (`anon_security_definer_function_executable`). So an attacker with the public anon key (it ships in the client bundle) can POST to `/rest/v1/rpc/email_for_username` with a guessed username and get that account's email + confirmation it's active — **bypassing the Server Action entirely.** D9's statement that "calling from the Server Action … is what actually closes the enumeration/harvesting risk" is **inaccurate**: *how the app calls it* doesn't matter when the endpoint itself is anon-callable. And "the RPC being anon-callable is unavoidable (login is pre-auth)" is also not true.
  - **Fix (makes the claim true + clears the advisor):** a Server Action runs server-side, so call the lookup with a **service-role client** (`SUPABASE_SERVICE_ROLE_KEY`, server-only), and `revoke execute on email_for_username from anon, authenticated` (grant `service_role` only, or just let the definer run as owner). Then the username→email mapping is never reachable with the anon key — genuinely closing the harvest path.
  - **Severity:** low *practical* risk here (2–3 staff, guessable-anyway emails, password still required, RLS still blocks all table/data access for anon) — hence ⚠️ not ❌. But it's a real disclosure and a security-claim overstatement, and the fix is cheap. Do it before pilot. The `authenticated` grant is likewise unnecessary (same disclosure extended to any logged-in user) and should go with it. → flag ㉑.

**Non-blocking suggestions:** none beyond ㉑.

**Domain / correctness checks:** Auth — username→email→`signInWithPassword` works; form-level enumeration prevented by the generic message ✓; **RPC-level disclosure open** (㉑). Registration still email+password admin-created (D3) ✓. No money/state surface. Spec docs (design-spec + salesman-app EMAIL→USERNAME label) updated consistently. ✓

**What I tried:** read the migration / actions.ts / LoginForm.tsx / page.tsx / D9; live checks — profiles usernames + `null_usernames=0` + `has_function_privilege('anon', …)=true`; **`set role anon; select email_for_username('mridul')` → returned the real gmail** (the harvest, proven); `get_advisors(security)` (confirms `anon`-executable `email_for_username`); `npm run build`/`lint` (exit 0).

**Open flags (cumulative):** No blocking items. **㉑ (new, security) `email_for_username` anon-harvestable — use a service-role lookup + revoke anon; correct D9's "closed" claim.** ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password, PLAN Q#7) remain.

**Next-commit suggestion:** the ㉑ service-role fix (small), then S3/S4 (where `submit_order` gets exercised through the app). A live login drive is now possible with the backfilled usernames if a test password is shared.

---

## Review of 0db66fd — fix(security): ㉑ — email_for_username was anon-harvestable, close it

**Verdict:** ✅ accept — ㉑ closed and **verified by execution**; the harvest I proved is now denied. Clean fix, honest in-place doc correction.

**Phase / commit goal (as I understood it):** Revoke the anon/authenticated grant on `email_for_username` and move the username→email lookup to a server-only service-role client, so the mapping is no longer reachable with the public anon key.

**What works — verified live:**
- **The harvest is closed.** `has_function_privilege`: `anon=false, authenticated=false, service_role=true`. Re-running my exact attack — `set role anon; select email_for_username('mridul')` — now raises **`permission denied for function email_for_username`** (was returning the real gmail before). ✓✓
- **`get_advisors(security)` no longer lists `email_for_username`** at all (a service_role-only function isn't externally callable) — the `anon_security_definer_function_executable` finding is gone; only the 5 accepted authenticated RPCs + `auth_leaked_password` (⑯) remain. ✓
- **`service.ts` is properly guarded:** `import "server-only"` makes an accidental Client-Component import a **build-time** error (not a runtime leak); the client uses `SUPABASE_SERVICE_ROLE_KEY` with `autoRefreshToken/persistSession: false`; the comment explicitly scopes it to *only* this lookup ("don't reach for this client for anything else"). `actions.ts` uses it for the lookup, the regular RLS-scoped client for the sign-in. Good separation + minimal blast radius. ✓
- **Docs corrected in place, not silently rewritten:** D9 and roles-and-permissions.md now record that the anon grant + the "server action closes the risk"/"anon-callable unavoidable" claims were **wrong**, cite my live proof, and explain why the *grant* is what controls access — matching how the D8 correction was handled. Honest log hygiene. ✓ `.env.example` documents `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC_`). `server-only` added to deps. build + lint exit 0. ✓

**Blocking issues:** None.

**Non-blocking suggestions / dependency:**
- **㉒ (config, owner action): username login is now non-functional until `SUPABASE_SERVICE_ROLE_KEY` is set** in `.env.local` (local) and Vercel env (deploy) — the service client can't call the lookup without it, so *every* sign-in fails until then. The BUILDER flagged this honestly ("NEEDS MRIDUL") and no MCP tool exposes the key (Project Settings → API). Same owner-action class as ⑯. Not a defect — a required setup step — but tracked so login isn't mistaken for broken.

**Domain / correctness checks:** Security — the deliberate anon exception is removed; anon is back to zero access; the lookup runs under `service_role` strictly server-side ✓ (verified). No RLS-policy change. No money/state surface.

**What I tried:** read the migration / service.ts / actions.ts / D9 + spec corrections; live `has_function_privilege` (anon/auth/service_role) + a `set role anon` call to `email_for_username` (now **denied**); `get_advisors(security)` (finding gone); `npm run build`/`lint` (exit 0).

**Open flags (cumulative):** **㉑ — ✅ CLOSED (verified).** No blocking items. **㉒ (new, config) set `SUPABASE_SERVICE_ROLE_KEY` before login works.** ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain.

**Next-commit suggestion:** S3/S4 (retailer picker + quick order → `submit_order` through the app). Once the service-role key is set, a live end-to-end login + role-routing drive becomes possible with the backfilled usernames (needs a test password).

---

## Review of 58d2158 — chore(security): rename SUPABASE_SERVICE_ROLE_KEY -> SUPABASE_SECRET_KEY

**Verdict:** ✅ accept — complete, accurate rename aligning with Supabase's new key naming. No behavior change.

**What works:**
- Renamed consistently across the live surfaces: `service.ts` (the `process.env` reader + comment), `.env.example` (with the Dashboard → Settings → API Keys → Secret keys pointer), and the D9 / roles-and-permissions / seed-data docs. `git grep SUPABASE_SERVICE_ROLE_KEY` at HEAD → the **only** remaining hit is `Prompts/supabase-setup-builder-prompt.md` (the frozen M1 builder prompt), correctly left as a historical artifact, as the commit states. ✓
- **Rationale is sound and the "no behavior change" claim is correct:** an `sb_secret_…` key still authenticates against Postgres as the `service_role` role, so the `grant execute … to service_role` from the ㉑ fix is unaffected — the env var is just renamed to match what it now holds (the client was already on `PUBLISHABLE_KEY`). ✓
- build + lint exit 0. ✓

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** No security/behavior change — the secret key still maps to `service_role`; the harvest fix (㉑) stands. Purely an env-var rename + doc alignment.

**What I tried:** read the diff; `git grep SUPABASE_SERVICE_ROLE_KEY HEAD` (only the frozen prompt remains); `npm run build`/`lint` (exit 0).

**Open flags (cumulative):** No blocking items. ㉒ now reads **`SUPABASE_SECRET_KEY`** (owner sets it before login works). ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain.

**Next-commit suggestion:** S3/S4 — `submit_order` through the app.

---

## Review of 12fdf61 — docs: park username-only (synthetic-email) auth in future-plans

**Verdict:** ✅ accept — accurate, well-reasoned parking of a real alternative; docs-only, D9 untouched.

**What works:**
- **The technical analysis is correct:** a synthetic `username@<fixed-domain>` identity lets login *construct* the email from the username, so it drops the `email_for_username` RPC, `SUPABASE_SECRET_KEY`, `service.ts`, the `server-only` dep, **and the ㉑ harvest concern** entirely — the entry says so plainly. Honest: the parked-simpler design is arguably *more* secure than what shipped. ✓
- **The tradeoff/dependency is nailed:** synthetic emails can't receive password-reset or notifications, so "only works under a single fixed domain; stay on D9 if real reachable emails are ever needed" is exactly right. ✓
- **Sound reason to park, not do:** it reverses D9 (built, reviewer-verified, working) and needs Dashboard account recreation (owner action, no MCP tool), for a simplification nothing is currently blocked on. The scope list (①–⑤) is complete. ✓
- Diff is **PLAN.md + future-plans.md only** — D9 and all code unchanged (confirmed). PLAN Unscheduled pointer updated to the 4th parked item, consistent with the entry. ✓

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** No code/behavior/spec-of-record change — D9 remains the shipped design. Good parking-lot discipline (decided direction + dependency + scope + revisit trigger), same pattern as the geotag / perf-pass / cancelled-view entries.

**What I tried:** read the diff; confirmed it touches only the two docs and leaves D9 + the auth code intact.

**Open flags (cumulative):** No blocking items. No new flag (parked idea with its own revisit trigger, not a REVIEWER obligation). ㉒ (secret key), ⑦⑧⑨ (M0 doc), ⑬ (seed loader), ⑭ (perf pass), ⑯ (leaked-password) remain.

**Next-commit suggestion:** S3/S4 — the salesman order-taking flow, where `submit_order` finally runs through the app.

---

## Review of ba387fa — docs: mark M1+M3 complete in PLAN; mirror the full open-items ledger

**Verdict:** ✅ accept — the status is substantially accurate and I closed most of the M3 verification gap by execution. Two non-blocking notes: the precise scope of "reviewer-verified live" for M3, and the mirrored-ledger drift.

**What works — claims checked, and one verified further by execution:**
- **M1 ✅ Done — accurate.** 11 migrations reviewer-verified (M1.1–M1.9), RLS 6-step ✓ (the stated exit criterion), app scaffolded (App Router/TS + `@supabase/ssr`), production build green.
- **㉒ resolved — verified.** `.env.local` has `SUPABASE_SECRET_KEY` set, and I confirmed it's **valid**: using it as the service client, `email_for_username('mridul')` → `mr***@gmail.com` and a bogus username → `null`. So the D9 username→email lookup works end-to-end with the real key. The PLAN mirror's "㉒ ✅ Resolved" is correct; my ledger updated to match (it was stale-open).
- **M3 ✅ Done — substantially accurate.** Exit criterion: "each role logs in and sees only what the matrix allows." Verified live: the **matrix** (RLS 6-step, M1.6/M1.8) and now the **username→email lookup** (above, with the real key). Verified by code review (with the ⑱ cookie-drop bug found *and* fixed): the middleware getUser-gate/role-routing, `signInWithPassword`, and deactivated lockout.

**Blocking issues:** None.

**Non-blocking suggestions:**
- **M3 "reviewer-verified live" is ~90% true — one step remains undriven.** I have *not* driven an actual password sign-in end-to-end (username + real password → `signInWithPassword` → cookie → middleware redirect → land on the role's screen), because the 3 test accounts' passwords aren't shared. Everything up to and including the email resolution is now verified live; the final password-gated hop is code-verified only. To make the claim fully literal, hand me one throwaway test password and I'll drive login + role-routing for a salesman and an accountant and confirm each lands correctly.
- **Mirrored ledger will drift.** PLAN.md now carries a full copy of my ledger. It already diverged (PLAN showed ㉒ resolved while my `comments.md` still said open, until this review). The note correctly says comments.md is the live source — good — but two hand-maintained copies *will* diverge again on the next flag change. Since I only ever commit `comments.md` (my protocol), keeping the PLAN copy in sync is on the BUILDER; consider a dated snapshot refreshed only at milestone boundaries, or a pointer, rather than a live duplicate. The current snapshot's contents match my ledger accurately (⑯⑬⑭⑦⑧⑨ open; ㉒ resolved; closed list ⑩⑪⑫⑮⑰⑱⑲⑳㉑). ✓

**Domain / correctness checks:** No code/behavior change — PLAN status + a ledger mirror. Milestone claims cross-checked against what I verified live (M1 migrations/RLS, ㉒ key validity, the lookup path) and by review (the auth flow). Accurate modulo the one undriven sign-in step.

**What I tried:** read the diff; confirmed `SUPABASE_SECRET_KEY` present in `.env.local` (name only); a throwaway node script using the **real secret key** to call `email_for_username` (valid username → masked email, bogus → null) — proving ㉒'s resolution + the lookup path live; cross-checked the PLAN mirror against my current ledger.

**Open flags (cumulative):** No blocking items. **㉒ — ✅ RESOLVED (key set + verified valid).** ⑯ (leaked-password), ⑬ (seed loader), ⑭ (perf pass), ⑦⑧⑨ (M0 doc) remain. (M3 end-to-end login drive: available on request with a test password.)

**Next-commit suggestion:** M4 — the salesman order flow (S3→S7 + the write RPCs through the app), where I'll exercise `submit_order`/`update_order_items` end-to-end via the UI and re-verify snapshot/idempotency through the real client.

---

## Review of bd32706 — docs: builder prompt for M4 — salesman order flow (S3-S7 + write RPCs)

**Verdict:** ✅ accept — an accurate, comprehensive, invariant-faithful M4 kickoff. Docs-only (a new `Prompts/` file).

**Phase / commit goal (as I understood it):** The BUILDER prompt for the salesman order flow (S3→S7 + write-RPC wiring), scoping M5 out.

**What works — cross-checked against the built state, the specs, and my prior verifications:**
- **Every hard invariant is stated correctly** and matches what I verified: client never sends prices (server snapshots), client-UUID idempotency (don't regenerate on retry), localStorage-only drafts (no DB draft rows), "locked" derived + enforced by the RPC guards with buttons **removed not disabled** at expiry, salesmen see **active AND priced only** (~34, RLS), ≥48px hit areas, qty cap 999 (stricter than the DB `1..9999`). All consistent with the RPCs/RLS/lifecycle I proved at M1. ✓
- **References are accurate:** the routes (`/login`, `/`, `/dashboard`, `/new-order` placeholder), the reusable primitives + `format.ts`/`order-status.ts`, the four Supabase clients, and "read `20260706T150400_rpcs.sql` for the exact `p_items` shape — don't guess." ✓
- **RPC wiring (§4) is faithful:** `submit_order` (product_id+qty only, idempotent on p_id), `update_order_items` (server diffs by product_id, survivors keep snapshot), `cancel_order` (salesman passes no reason) — exactly the behaviour I verified. ✓
- **Acceptance criteria (§5) are falsifiable and match my obligations:** <90s stopwatch; airplane-mode draft + offline submit → **exactly one** row; double-tap → one row; **countdown→0 flips UI read-only AND a forged `update_order_items` is rejected *server-side* (verify the RPC, not just the UI)**; never renders unpriced/inactive; order detail reconstructs edits from `order_events`. These are precisely the tests I'll run. ✓
- **M5 correctly scoped out** (§6): `process_order`, the S9 workbench, S10 pick slip, S11 verification queue, dashboard realtime/filters — explicitly deferred; "don't extend the S8 shell into the workbench." Prevents scope creep. ✓
- **§7 Do-NOTs** reinforce the invariants (no client prices, no UUID regen, no draft DB rows, no disabled-vs-removed buttons, `getUser()` not `getSession()`, no design-system fork/shadows). ✓
- **Anticipates my test path:** §5 tells the BUILDER to hand the REVIEWER the 3 accounts (passwords from Mridul) and names the salesman account for driving the flow — aligns with my open offer to drive login end-to-end once a credential exists. ✓

**Blocking issues:** None. **Non-blocking suggestions:**
- The prompt says the foundation is "reviewer-verified" — true, with the one caveat from my ba387fa block (an actual password sign-in hasn't been driven; RLS matrix + lookup path *are* live-verified). Immaterial to the M4 work.
- Process note: M4 moves to branch `feature/salesman-app`; my HEAD watcher follows the shared checkout, so I'll keep seeing commits.

**Domain / correctness checks:** No code/behavior change — a kickoff prompt. Its encoded invariants match the money/snapshot/idempotency/state-machine/RLS rules I've verified; nothing in it would steer the BUILDER into violating a spec.

**What I tried:** read the prompt end-to-end against salesman-app.md / the design spec / order-lifecycle.md / the RPC migration and my prior review blocks; checked each named file/route/RPC exists as described.

**Open flags (cumulative):** No blocking items. ⑯ (leaked-password), ⑬ (seed loader), ⑭ (perf pass), ⑦⑧⑨ (M0 doc) remain; ㉒ resolved. My M4 test obligations now activate: the airplane-mode/idempotency/post-expiry-guard/`order_events` acceptance criteria, driven through the app.

**Next-commit suggestion:** deliverable #1 — the cart store + localStorage draft + submit-queue infrastructure — then S3.

---

## Review of 96880f5 — feat(m4): draft/pending-order infra + Stepper/KeypadSheet/BottomSheet primitives

**Verdict:** ⚠️ accept-with-followups — the infra is clean, spec-faithful, and the live RPC contract is verified end-to-end; two non-blocking hardening items (㉓, ㉔) must land before the consumer screens (S3–S7) wire this up. Nothing here is broken on its own base, so it's not a blocker — but both run the *wrong* direction of a fail-safe, so I'm not filing plain ✅.

**Phase / commit goal:** M4 deliverable #1 — client-only cart drafts (`lib/cart.ts`), an offline pending-submission queue (`lib/pending-orders.ts`), thin wrappers over the four write RPCs that separate offline failures from server rejections (`lib/order-rpcs.ts`), plus three design-system primitives (`BottomSheet`, `Stepper`, `KeypadSheet`). Explicitly no DB contact — `submit_order` still sees each order for the first time already `submitted`.

**Scope note:** reviewed the commit, **not** the working tree — `new-order/page.tsx` (+deleted `new-order.module.css`) is uncommitted WIP and out of scope here; the 9 committed files were clean in the tree, so my reads == the commit.

**What works — verified by execution, not reading:**
- **Live RPC contract matches all four wrappers exactly** (queried `pg_get_function_arguments` on `ugjwcbxyyuowiyhczcrh`): `submit_order(p_id,p_retailer_id,p_notes,p_items)`, `update_order_items(p_order_id,p_notes,p_items)`, `cancel_order(p_order_id,p_reason DEFAULT NULL)`, all `returns orders`. So the wrapper omitting `reason` is safe (SQL default fills it), and every `as OrderRow` cast is honest — the RPCs really return the row. ✓
- **The renamed-helper trap is NOT tripped:** the migration text still shows `submit_order` calling `public.current_role()` (line 23), but the *live* body calls `auth_profile_role()` — confirmed via `pg_get_functiondef`. Traced the replay: `20260706T150800_rename_current_role.sql` renames the helper (OID preserved → the `150500` RLS policies follow it automatically) **and** recreates all four RPCs against the new name; `150900` recreates `cancel_order` again with `cancelled_by`. A fresh `db reset` lands exactly on live — no drift, no runtime break. ✓
- **Spec fidelity:** client sends only `{product_id, qty}` (`toItemsPayload`) — never a price (snapshots are server-side); `orderId = crypto.randomUUID()` is minted once in `createDraft` and reused across retries (the idempotency contract — "never regenerate"); drafts + pending queue live entirely in `localStorage`, keyed by retailer for S3's resume-draft. Matches data-model.md "drafts never touch the DB." ✓
- **`pending-orders` queue is idempotent on `orderId`** — `savePending` de-dupes by filtering the existing id before append; `removePending` filters it out. Re-saving the same order replaces rather than duplicates. ✓
- **All storage reads are corruption-safe** — `loadDraft`/`listPending` wrap `JSON.parse` in try/catch → null/`[]`; every accessor guards `typeof window === "undefined"` for SSR. ✓
- **Primitives are sound & spec-aligned:** `Stepper` clamps `[0..max]` with disabled bounds + ≥48px hit target; `KeypadSheet` caps at 3 digits / `max`, empty ⇒ 0 (removes line), own numeric keypad per S4; `BottomSheet` scrim-tap closes with `stopPropagation` on the sheet body. ✓

**Offline classifier — tested across every failure shape supabase-js can emit** (extracted `isOfflineFailure`/`callRpc` verbatim, ran under node):
- throw `TypeError` (transport) → `OfflineError` ✓ · resolved `{error}` + `navigator.onLine=false` (airplane) → `OfflineError` ✓ · real server rejection online → `Error(message)` shown plainly ✓ · success → data ✓.
- **The gap (㉓):** a fetch failure that supabase-js *resolves* as `{error:{message:"Failed to fetch"}}` (a plain object, **not** a `TypeError` instance) while `navigator.onLine` still reads `true` — wifi-connected-but-no-internet, captive portal, DNS failure, flaky signal — falls through to `throw new Error(...)` and is treated as an **authoritative rejection**, so it would *not* be queued for retry. That's the silent-loss case resilience.md forbids, and getting it right is this infra's one job. `navigator.onLine=true` is famously unreliable (it means "has a link," not "can reach the server"). Robust fix: discriminate on **the presence of a Postgres error `code`** — a genuine rejection carries a SQLSTATE (`P0001` from `raise exception`, `23505`, …); a transport failure has none — rather than trusting `navigator.onLine`.

**Second follow-up (㉔):** neither `toItemsPayload` nor the cart strips `qty<=0`, yet `Stepper`/`KeypadSheet` can legitimately set a line to 0 (= remove). A zero-qty line reaching `submit_order` fails the DB `qty between 1 and 9999` check and **rejects the whole order**. The consumer must filter `qty>0` when building the payload (or drop zero keys on cart write). Cheap to fix, nasty if missed.

**Why not blocking:** both items live in infra that nothing consumes yet (the consumer `page.tsx` is uncommitted). The base isn't broken — cart, queue, and primitives each work standalone, and the dominant offline case (airplane → `navigator.onLine=false`) *is* handled. So: accept, but ㉓/㉔ must be closed **in or before** the S3–S7 commits that wire the submit path — not after.

**Domain / correctness checks:** money stays integer paise (`cartTotalPaise` sums `price*qty`, display-only — real total is trigger-computed server-side, and the comment says so); no floats; no client-trusted prices; idempotency id preserved; zero draft rows in Postgres. All consistent with the invariants.

**What I tried:** read all 9 committed files at the commit; queried the live project for the four RPC signatures + `submit_order`'s live body (`calls_current_role=false`, `calls_auth_profile_role=true`); grepped the migration set to prove the `current_role→auth_profile_role` replay is self-consistent; ran a verbatim node harness of the offline classifier across throw/resolve × online/offline × server-reject × success (5 cases, output matched the analysis exactly).

**Open flags (cumulative):** No 🔴 blocking. **New:** ㉓ (offline misclassification → silent-loss risk), ㉔ (zero-qty line poisons submit) — both 🟡, close before/with the S3–S7 consumer. Carried: ⑯ (leaked-password), ⑬ (seed loader), ⑭ (perf pass), ⑦⑧⑨ (M0 doc). My M4 acceptance tests (airplane→exactly-one-row, double-tap→one row, countdown→0 flips read-only + forged post-expiry `update_order_items` rejected **server-side**, `order_events` reconstruction) activate once the consumer screens land.

**Next-commit suggestion:** S3 (retailer pick + resume-draft sheet) or S4 (catalog + Stepper/keypad) — and fold ㉓/㉔ in as you wire the submit path.

---

## Review of 97272b4 — feat(m4): S3-S6 — pick retailer, quick order, review, submit, confirmation

**Verdict:** ✅ accept — the full create-order flow, correct on every load-bearing axis I could execute against; **both prior follow-ups (㉓, ㉔) are verifiably closed**. One 🟡 non-blocking edit/resume-mode display edge (㉕) + a duplicate import that the very next commit (ff906c9) already fixes.

**Phase / commit goal:** S3 PickRetailer → S4 QuickOrder → S5 Review → S6 Confirmation, orchestrated by `NewOrderFlow` (one `useReducer`), plus edit-mode (pre-fill from an existing order, call `update_order_items` instead of `submit_order`). Claims to fold in ㉓ (offline classification by SQLSTATE) and ㉔ (drop `qty<=0`).

**㉓ CLOSED — verified by execution.** Re-ran the verbatim `isOfflineFailure`/`callRpc` under node across 7 shapes. The exact ㉓ case — a fetch failure supabase-js *resolves* as `{message}` with **no `code`** while `navigator.onLine` reads `true` (captive portal / DNS / flaky signal) — now returns `OfflineError` (retryable) instead of a hard `Error`. Server rejections carrying a SQLSTATE (`P0001`, PostgREST `PGRST202`) still surface plainly; a code-less 503 is treated as retryable, which is **safe because `submit_order` is idempotent on `orderId`** (no dup on retry). New discriminator: `error instanceof TypeError || !navigator.onLine || (has message && no code)`. Correct.

**㉔ CLOSED — verified by execution.** `toItemsPayload({a:2,b:0,c:5,d:-1})` → `[{a,2},{c,5}]`; zero/negative lines dropped before the payload. Belt-and-suspenders: the `CHANGE_QTY` reducer also `delete`s the key at `qty<=0`, so zeros never persist in the cart either.

**What works — verified against the live project + node, not just read:**
- **D2 is real at the wall.** `products_select_salesman` USING = `auth_profile_role()='salesman' AND active AND price_paise IS NOT NULL` (queried live). So `page.tsx`'s "catalog = active AND priced, RLS guarantees it" is accurate — QuickOrder can only render what RLS returns; an unpriced/inactive product can't leak. ✓
- **Quick-add is RLS-legal.** `retailers_insert_salesman` WITH CHECK = `salesman AND verified=false AND created_by=auth.uid()`; `PickRetailer.submitQuickAdd` inserts exactly `{verified:false, created_by:salesmanId}` where `salesmanId=user.id`, and the `active=true` default lets the `RETURNING` select pass `retailers_select_salesman`. ✓
- **Idempotency contract intact.** `orderId` is minted once (`createDraft`→`crypto.randomUUID`) and reused; on `OfflineError` it's queued under the *same* id (`savePending`), and the retry re-calls `submitOrder(sameId)`. Server idempotency was proven at M1; the client never regenerates. So airplane→exactly-one-row and double-tap→one-row both hold. ✓
- **Double-tap also guarded at the UI:** `Button` sets `disabled={disabled || loading}`, and `handleSubmit` flips `submitting` on entry — the CTA is disabled through the in-flight request. ✓
- **Confirmation is server-truth only** — reached solely via `SUBMIT_SUCCESS_CREATE` (dispatched only after `await submitOrder` resolves), and renders `order.order_ref / total_paise / editable_until` from the response, never a client estimate. Offline/error paths never navigate to it. ✓
- **Edit-mode is correctly separated:** `isEdit` calls `update_order_items` (not `submit_order`), never writes a localStorage draft (`persist` no-ops), pre-fills from `editOrder`, and `page.tsx` gates the `?edit=` path server-side (`status='submitted' AND editable_until>now()`, else `redirect` to the order). Existing lines display their **snapshot** price (`{...catalog, ...snapshotPrices}`), so a re-price never rewrites a survivor line. ✓
- **Reopen-the-app resume (criterion #2)** is one atomic `RESUME_ON_MOUNT` dispatch; if the draft is already in the pending queue it lands on Review with the offline strip. Money stays integer paise throughout; totals are display-only (server recomputes). ✓

**Blocking issues:** None.

**Non-blocking (🟡 ㉕) — stale/deactivated line is hidden but still counted & submitted.** In `Review`/`QuickOrder` the display maps (`byId`, `lines`) are built **only from the current catalog** (`products`), while `total` and the submit payload iterate the full `items`. If an item's product has left the salesman's active+priced catalog — an edit within the 2h window after the office deactivates/unprices it, or a resumed create-draft — that line is silently dropped from the list yet still included in the total (via `snapshotPrices`) and still sent. In **edit** that yields total ≠ visible lines and an un-removable ghost line; in **create** `submit_order` rejects the whole order (product not available, `P0001`) but the offending line is invisible, so the error is hard to act on. No data loss (server keeps snapshots), and it needs a mid-window catalog change, so it's rare — but the fix is small: the edit query should also `select` `order_items.product_name` and merge unknown-product ids into the display maps (render them as "unavailable — remove"). Files: [page.tsx](src/app/new-order/page.tsx#L93), [Review.tsx](src/app/new-order/Review.tsx#L58), [QuickOrder.tsx](src/app/new-order/QuickOrder.tsx#L103).

**Minor:** (a) `Confirmation.tsx` had two `import … from "@/lib/format"` lines — legal TS but an `import/no-duplicates` smell; already merged in ff906c9 (reviewed next). (b) Retailer quick-add is a direct client insert with no offline queue — offline it just errors and the salesman retries; only the *order* path is offline-resilient. Fine per scope, noting it.

**What I tried:** read all 11 files at the commit; re-ran the ㉓ classifier (7 cases) and ㉔ filter under node; queried live `pg_policies` for products+retailers to confirm D2 and the quick-add WITH CHECK; traced the reducer's submit/offline/edit branches and the resume-on-mount effect; confirmed `Button` disables on `loading`. Server idempotency relied on here was proven live at M1.

**Open flags (cumulative):** No 🔴 blocking. ㉓, ㉔ **closed** (this commit). **New:** 🟡 ㉕ (hidden-but-submitted stale line). Carried: ⑯ (leaked-password), ⑬ (seed loader), ⑭ (perf pass), ⑦⑧⑨ (M0 doc). Still to test once S7 lands: countdown→0 flips read-only **and** a forged post-expiry `update_order_items` is rejected server-side; `order_events` reconstruction on the detail screen.

**Next-commit suggestion:** already in flight (S7 `9ccac24`) — I'll verify cancel/edit + `order_events` history there, and drive the post-expiry-guard test live.

---

## Review of 9ccac24 — feat(m4): S7 — order detail, edit/cancel, order_events history; wire Home

**Verdict:** ✅ accept — the detail/edit/cancel/history layer, with **every headline M4 server guard proven live**. One real-but-rare resilience edge (🟡 ㉖ silent-drop) + two minor UX notes (🟡 ㉗); none blocking.

**Phase / commit goal:** `/orders/[id]` (snapshot lines, retailer card, status+countdown, HISTORY reconstructed from `order_events`), `OrderActions` (Edit→`?edit=`, Cancel→`cancel_order`, mounted only while owner+editable), the pinned `PendingOrdersStrip` offline-retry driver on Home, and `OrderCard`→detail link.

**Proven live (execute-not-read), in one rolled-back transaction as the real salesman `f637b8d0…`:**
- **Idempotency / double-tap → one row:** two `submit_order` calls with the *same* client id → `rows=1`, identical `order_no`, and the second call's differing payload (`qty 999`) was **ignored** (line stayed `qty 3`). The whole client design (reuse `orderId` on retry) rests on this, and it holds. ✓
- **Post-expiry guard (the load-bearing half of "countdown→0 = read-only"):** forced `editable_until` into the past, then the salesman's `update_order_items` → **REJECTED `edit window has passed`**, and the row was **unchanged** (no partial apply). The UI removing the buttons is best-effort; this server rejection is the real wall. ✓ (DB restored: orders/items/events back to 0, `order_no_seq` reset to 1001.)
- **HISTORY reconstruction is faithful:** cross-checked the live RPC bodies — `submit_order`→`'submitted'`, `update_order_items`→`'items_changed'`/`'edited_after_lock'` with `details {before,after:[{sku,qty,unit_price_paise}]}`, `cancel_order`→`'cancelled' {reason}`, `process_order`→`'processed'`. `describeEvent`'s `switch` + `diffLines(before,after by sku)` match every action and shape, so HISTORY renders plain words, never raw fallback. ✓

**What else works (verified by read against live RLS):**
- **Detail page is RLS-scoped** — server client + `getUser`, `.maybeSingle()` → `notFound()` on null, so a salesman hitting another's `/orders/<id>` gets 404 (orders RLS returns nothing), no leak. `editable` is derived server-side (`status='submitted' AND editable_until>now`), and `OrderActions` is **not mounted** past the window / for non-owners — removed, not disabled, per spec. ✓
- **Retry driver is correct where it counts:** `sync` reuses `order.orderId` (→ idempotent, proven), `useSyncExternalStore` with a **stable** snapshot (`listPendingSnapshot` memoizes on the raw string, avoiding the infinite-render trap), subscribes same-tab (`CHANGE_EVENT`) + cross-tab (`storage`) + the `online` event, and is actually mounted on Home. ✓
- Cancel goes through the offline-aware wrapper + a confirm sheet (no salesman reason, matching the RPC), then `router.refresh()`. `OrderCard` wraps in `<Link href={/orders/${id}}>`. Money stays integer paise; totals are server-computed. ✓

**Blocking issues:** None.

**🟡 ㉖ — pending order silently discarded on a real server rejection.** In [PendingOrdersStrip.tsx:36](src/components/PendingOrdersStrip.tsx#L36), `sync`'s catch does `if (!(error instanceof OfflineError)) removePending(order.orderId)` — i.e. a genuine server rejection (e.g. a product went unpriced/inactive between queue and retry → `submit_order` raises `P0001`) makes the strip **vanish with no message**. It correctly avoids retrying a permanent failure forever, but the resolution is silent-drop: the salesman sees the "Saved on phone" strip disappear — the same signal as success — while the order was actually thrown away. That's the "no silent loss" / false-success case resilience.md is built to prevent. Rare (needs a mid-flight catalog change), non-blocking, but before pilot it should **surface** the failure — keep the order visible in an error state with the reason ("couldn't submit: …"), not discard it quietly.

**🟡 ㉗ — two minor UX notes.** (a) An offline **cancel/edit** surfaces `OfflineError`'s copy "You're offline — this will retry automatically," but only *submit* is queued — cancel/edit aren't retried, so the message over-promises. (b) HISTORY shows real staff **names** (e.g. "Cancelled by Priya"), not the code's apparent `?? "the office"` intent, because `profiles_select_active` (M1, intended) lets any active staff read the directory — confirm with the owner that surfacing staff names to salesmen is desired.

**What I tried:** read all 10 files at the commit; live idempotency + post-expiry-rejection test as the salesman (rolled back, sequence restored); cross-checked the RPC event catalog against `describeEvent`; confirmed the detail-page RLS scoping, the `editable` derivation, the `useSyncExternalStore` snapshot stability, and that the strip is mounted on Home.

**Open flags (cumulative):** No 🔴 blocking. **New:** 🟡 ㉖ (silent-drop on rejection — pre-pilot), 🟡 ㉗ (offline copy + history names). ㉕ fix (`48ed20f`) is in my queue next. Carried: ⑯ (leaked-password), ⑬ (seed loader), ⑭ (perf pass), ⑦⑧⑨ (M0 doc). M4 acceptance criteria now all exercised: <90s flow (untimed), idempotent submit ✓, double-tap→one row ✓, countdown→0 read-only + server post-expiry reject ✓, never-renders-unpriced (RLS) ✓, `order_events` reconstruction ✓.

**Next-commit suggestion:** review `ff906c9` (dup-import) + `48ed20f` (㉕), then a real end-to-end login/order pass once a throwaway salesman password is available (my one still-undriven step).

---

## Review of ff906c9 — style: merge duplicate lib/format import in Confirmation.tsx

**Verdict:** ✅ accept — pure cleanup, no behavior change. Merges the two `import … from "@/lib/format"` lines I flagged in the 97272b4 block into one (`{ formatRupees, formatCountdown }`). Nothing else touched; `tsc --noEmit` and `eslint` both exit 0 on the resulting tree.

---

## Review of 48ed20f — fix(m4): ㉕ — surface a stale/deactivated line instead of hiding it

**Verdict:** ✅ accept — closes 🟡 ㉕ exactly as recommended; no new issues; type-clean.

`page.tsx`'s edit query now selects `order_items.product_name` → `EditOrderData.snapshotNames`. `NewOrderFlow` threads `snapshotNames` into both QuickOrder + Review and, **create-mode only**, `pruneStaleItems` drops any item id absent from the current catalog on draft load / resume / select. `Review` now renders a stale line by its snapshot name, marked "no longer orderable" (no Stepper, a Remove button), so `total` == the visible lines again instead of exceeding them; `QuickOrder` gets a "NO LONGER AVAILABLE" section. The **edit-surfaces / create-prunes** split is the right call — an edit has an `order_items` snapshot (name+price) to show, a resumed create-draft has none, so there's nothing meaningful to render or submit for it. Verified: `tsc --noEmit` exit 0 (the `snapshotNames` prop is threaded through every hop) and `eslint` exit 0. **㉕ CLOSED.**

---

## Review of 48913ec — fix(m4): ㉖ — surface a real pending-order rejection instead of discarding it

**Verdict:** ✅ accept — closes 🟡 ㉖ (and ㉗(a)); the silent-loss gap is properly resolved; type/lint-clean.

`PendingOrder` gains `lastError`; `sync`'s catch now calls `markPendingFailed` (keep the entry, tagged with the server's reason) instead of `removePending`, and the strip renders a red **"Couldn't submit this order"** with the reason + **Try again** / **Discard**. The `online` auto-retry skips entries that already have `lastError`, so a permanent rejection isn't hammered forever — only an explicit tap re-attempts. That's the correct resolution of the infinite-retry-vs-silent-loss tension I raised: stop auto-retrying, **stay visible**, let the salesman decide. Idempotency is untouched (same `orderId`; a manual retry can't duplicate — proven at 9ccac24). **㉗(a):** `OfflineError`'s copy is now neutral ("Check your connection and try again"), and `Review`'s offline strip branches edit vs create so it no longer promises a persistent queue edit-mode doesn't have. Verified: `tsc --noEmit` + `eslint` exit 0. **㉖ CLOSED; ㉗(a) closed** — ㉗(b) (HISTORY shows real staff names vs "the office") remains an **owner-confirm**, not a bug.

**Open flags (cumulative):** No 🔴 blocking. ㉓ ㉔ ㉕ ㉖ ㉗(a) all **closed** — the entire M4 create/edit/cancel/resilience surface is now reviewer-verified. Remaining: 🟡 ㉗(b) owner-confirm (staff-name visibility in history); carried ⑯ (leaked-password, pre-pilot owner toggle), ⑬ (seed loader), ⑭ (perf pass), ⑦⑧⑨ (M0 doc). Still offered: a real end-to-end login+order drive once a throwaway salesman password exists (the one undriven step).

---

## Review of a5fd608 — docs: builder fix-prompt for the sticky bottom-bar (overflow-x breaks sticky)

**Verdict:** ✅ accept — docs-only builder fix-prompt (new `Prompts/fix-bottombar-builder-prompt.md`, 16 lines). Sound diagnosis, premises match the current code exactly, and it prescribes the standard robust app-shell fix. No behavior change in this commit; no spec risk.

**Premises verified against the live tree (not assumed):**
- [globals.css:51–53](src/app/globals.css#L51) really is `html, body { overflow-x: hidden }`. ✓
- [BottomTabBar.module.css:1–6](src/components/BottomTabBar.module.css#L1) `.bar` really is `position: sticky; bottom: 0; height: 70px`. ✓
- [page.module.css:1–4](src/app/page.module.css#L1) `.page` really is `display:flex; flex-direction:column; min-height: 100vh`. ✓

**Diagnosis is correct CSS.** With `overflow-x: hidden` against a default `overflow-y: visible`, the spec computes `overflow-y` to `auto` — so `body` becomes a scroll container, and a scroll-container ancestor is exactly what perturbs `position: sticky` on a descendant bar. The prescribed fix is the canonical mobile app-shell: `height: 100dvh` flex-column shell, a `flex:1; overflow-y:auto; min-height:0` scrolling region (the `min-height:0` note is the real flexbox "won't shrink to allow internal scroll" gotcha — correctly called out), the bar demoted to a normal always-visible flex child (drop sticky), and the global `overflow-x:hidden` removed. `100dvh` also fixes the mobile URL-bar gap and `env(safe-area-inset-bottom)` is the right iOS touch. All accurate; the visual outcome is unchanged (always-visible bottom nav) but achieved more robustly.

**The one risk it (correctly) flags for the fix commit:** removing the global `overflow-x: hidden` can expose a horizontal scrollbar if any element overflows sideways — the prompt says to clip that specific element instead. I'll verify on the actual fix commit that no horizontal scroll appears and the bar is visible on load (its own stated acceptance check). I can't drive a browser here, so bug/fix efficacy rests on the (sound) CSS reasoning + verified premises; the rendered result gets checked when the code lands.

**Open flags:** unchanged — no 🔴 blocking; only 🟡 ㉗(b) (owner-confirm) open. This prompt introduces none.

**Next-commit suggestion:** the bottom-bar CSS fix itself — I'll verify the app-shell layout + no-horizontal-scroll then.

---

## Review of 2c69d999 — fix: crypto.randomUUID() throws in an insecure context, breaking S3 taps

**Verdict:** ✅ accept — correct root-cause fix, proven by execution; unblocks LAN/mobile testing. Closes a gap I'd noted-but-under-weighted at 96880f5.

**The bug:** `createDraft()` called `crypto.randomUUID()` directly, which is spec-gated to secure contexts (https / http://localhost). A phone hitting the dev server at `http://<lan-ip>:3001` is insecure → the method is absent → the call throws inside the retailer-select click handler. (At 96880f5 I wrote "crypto.randomUUID — fine on HTTPS/localhost, note only" — I flagged the gating but judged it immaterial because Vercel is HTTPS, under-weighting plain-LAN device testing, which is exactly where it bit. Good catch by the builder via real mobile testing.)

**The fix:** `generateOrderId()` uses `crypto.randomUUID()` when present, else builds a v4 UUID from `crypto.getRandomValues()` — which, unlike `randomUUID`, is **not** secure-context-gated, so it works over LAN http. The bit-twiddling is correct RFC 4122 v4 (`bytes[6]=…|0x40` version, `bytes[8]=…|0x80` variant).

**Verified by execution** (verbatim fallback under node, forced down the `getRandomValues` branch): **200,000** generated → **0** invalid-format (all match `^…-4…-[89ab]…$`), **200,000 unique** (no collisions). Samples e.g. `1b2a2d20-6ca9-43d9-8f43-fd08384b97a4`. Postgres accepts these as `uuid`, so the idempotency-key / PK contract holds. `grep randomUUID src/` confirms cart.ts is the **only** call site — no other unguarded usage remains.

**Notes:** the commit's secondary theory (one uncaught throw makes the whole page's React tree go inert so every later tap no-ops) is plausible but I didn't independently reproduce the mobile-LAN React behavior — immaterial, since the fix removes the throw entirely. The fallback assumes `crypto.getRandomValues` exists; safe here — `createDraft` is client-only (click handlers / reducer), never SSR, and `getRandomValues` is universally available in browsers (no secure-context gate).

**Open flags:** unchanged — no 🔴 blocking; only 🟡 ㉗(b) (owner-confirm) open.

**Next-commit suggestion:** still the bottom-bar CSS fix (a5fd608's prompt) — app-shell layout + no-horizontal-scroll check when it lands.

---

## Review of 4cdeb82 — fix: bottom tab bar hidden until scroll (app-shell layout)

**Verdict:** ✅ accept — implements a5fd608's prescription faithfully; DOM structure verified correct. *(This commit landed between Monitor pings and I nearly flagged 13d5058's "bottom-bar fixed" claim as drift on the assumption it hadn't landed — checked `git log` first, and the fix is real. Verify, don't assume.)*

**What changed (matches the prompt exactly):** `overflow-x: hidden` removed from `html,body` (the sticky-breaker; `max-width:100vw` kept as the horizontal guard); `.page` `min-height:100vh`→`height:100dvh`; `.content` gains `flex:1; min-height:0; overflow-y:auto` (the flexbox "won't shrink to scroll" fix); `.empty` gets `min-height:0`; `.account` + `.bar` get `flex-shrink:0`; `.bar` drops `position:sticky; bottom:0` and adds `padding-bottom: env(safe-area-inset-bottom,0px)`.

**Structure verified against the DOM ([page.tsx:54–95](src/app/page.tsx#L54)):** `.page` (100dvh flex-col) → `PendingOrdersStrip` · `.content`/`.empty` (the `flex:1` scroll region = orders list) · `.account` (shrink:0) · `BottomTabBar .bar` (shrink:0). So the list scrolls internally while footer + nav stay pinned and visible on load — exactly the app-shell intended. Scope is right: only Home mounts `BottomTabBar`, so only `page.module.css` needed the shell (the S3–S7 flow screens use `FlowHeader`, no tab bar).

**What I could not verify here (no browser):** the visual outcome — bar visible on load + **no horizontal scrollbar** now that the global `overflow-x:hidden` is gone. `max-width:100vw` is retained as a guard, the layout is single-column mobile, and this fix came from the owner's real device testing — so I accept the rendered result on that basis; the CSS structure itself is correct. If a wide element (long unbroken SKU/name, the keypad grid) ever pokes past the viewport, clip that element per the prompt's own note.

**Nit (trivial):** `PendingOrdersStrip` is the one direct `.page` child without `flex-shrink:0`; with many failed/pending strips on a very short viewport it could be squeezed. Realistically 0–2 entries above the scroll region — immaterial.

**Open flags:** unchanged — no 🔴 blocking; only 🟡 ㉗(b).

---

## Review of 13d5058 — docs: mark M4 complete in PLAN; mirror the current review ledger

**Verdict:** ✅ accept — accurate against my review record; the ledger mirror matches comments.md.

**Claims cross-checked against what I actually verified:**
- M4 (S3–S7) marked ✅ Done, all commits reviewer-accepted — matches. "idempotent submit, double-tap→one row, post-expiry server-side reject **proven live by the REVIEWER**" — accurate; I proved all three live against the real DB.
- "Two device bugs found in real phone testing fixed along the way: sticky bottom-bar visibility, and `crypto.randomUUID()` in insecure context" — **both accurate**: 4cdeb82 (reviewed above ✅) and 2c69d999 (✅). I verified 4cdeb82 exists and is correct before accepting this claim.
- Airplane-mode drill "deferred (owner, later); not blocking" with "idempotency and the offline-classifier path already reviewer-proven by execution" — honest: I proved idempotency + the classifier by execution but did **not** drive a true end-to-end airplane-mode pass; the deferral is stated in the row, not hidden.
- Owner's 90-second stopwatch test "passed" — the owner's own testimony; not something I verify.

**Ledger mirror is faithful:** ㉗(b) added as the sole open owner-confirm; the closed list correctly adds ㉓ ㉔ ㉕ ㉖ ㉗(a); ㉒ resolved (Vercel-env note retained); ⑯ ⑬ ⑭ ⑦ ⑧ ⑨ carried accurately. "Next: M5 — accountant dashboard" matches the M4 prompt's scoping.

**One soft note:** the M4 gate text still reads "All 6 acceptance criteria, incl. … airplane-mode drills," and the row marks ✅ Done with that drill explicitly deferred — technically one gate criterion is carried, not met. Transparently stated in the row, so not drift; just flagging that "Done" here = "Done minus a deferred, non-blocking manual drill."

**Open flags:** unchanged — no 🔴 blocking; only 🟡 ㉗(b) (owner-confirm). M4 is fully reviewer-verified bar the deferred airplane-mode drill + the real-UI login drive I've offered.

---

## Review of 03b7fa0 — docs: M5 builder prompt (accountant/admin dashboard) + add-user runbook

**Verdict:** ✅ accept — a strong, mostly-accurate M5 kickoff (docs-only: builder prompt + add-user runbook), invariant-faithful on the load-bearing points. **Two claims I verified false against the live DB need correcting so the BUILDER isn't misled (🟡 ㉘, ㉙)**, plus one minor spec-vs-impl note.

**Verified accurate (live):**
- **`process_order` rejects a salesman server-side** — forged salesman call → "only accountant/admin may process orders" (proven live, rolled back). So acceptance #2's server half is real. ✓
- **D2 pricing visibility** — a price set on a TBD SKU becomes salesman-visible with no deploy, via `products_select_salesman` (`salesman AND active AND price_paise IS NOT NULL`). Acceptance #6 satisfiable. ✓
- **Runbook D9 flow** — `create_profile_for_new_user` really reads `full_name` + `raw_user_meta_data` (so "trigger auto-creates … username and full_name" is correct); username rules match the `profiles.username` CHECK; deactivate-never-delete and "email_for_username returns the email only for an active profile" all accurate. ✓
- Re-grounding is faithful: ₹ integer paise via `formatRupees`, no tax (D5 GST-inclusive), our statuses + real `order_events` catalog, RPC-only order writes + RLS-granted UPDATE for products/retailers, print-CSS pick slip (no PDF lib), no Users tab. The two owner deviations (phone version; in-app Products tab) are recorded with same-commit changelog discipline. ✓

**🟡 ㉘ — acceptance #3 (post-lock edit reason) is not RPC-ready; the prompt implies it is.** §4.3 says the after-window Edit "requires a reason and logs `edited_after_lock` … the RPC already enforces this." Verified live: `update_order_items(p_order_id, p_notes, p_items)` has **no reason parameter** and writes **no `reason`** into the event `details` (body has `edited_after_lock` but zero `reason`). The parenthetical is only true for the *snapshot* semantics (survivors keep price — that the RPC does enforce). To satisfy #3 ("… with before/after **and reason**"), `update_order_items` must gain a `p_reason` that lands in `details.reason` — the spec lists `reason?` as optional (order-lifecycle.md:72) and `describeEvent` already reads it, but no migration writes it. That's a **security-definer RPC change** the prompt should name explicitly (I'll re-verify when it lands), not fold under "already enforces this."

**🟡 ㉙ — runbook misdescribes the login security model (post-㉑).** "Why it's these steps" says "client → `public.email_for_username(username)` (**anon-callable**…)". Live grants: **anon=false, authenticated=false, service_role=true** — the ㉑ fix (0db66fd) revoked anon/auth to stop the email-harvest, and login now runs client → server action (`signInWithUsername`) → **service-role** client → `email_for_username`. The operational steps are fine (SQL Editor runs as service_role), but this explanation is wrong and, if trusted, could invite re-granting anon and reopening ㉑. Correct it to the server-action + service-key flow.

**Minor (spec-vs-impl):** the prompt lists `retailer_quick_added` among timeline events. It's in the spec catalog (order-lifecycle.md:75) so the prompt isn't inventing it — but **no RPC emits it** (verified: zero emitters; `submit_order` writes only `submitted`). The timeline humanization for it is a no-op until `submit_order` is extended to log it. Heads-up so the BUILDER doesn't build UI for an event that never fires.

**Operational note (found during this review, already resolved):** verifying live, I found **4 real orders now exist** (`order_no` 1001–1004 — the owner's 90-second stopwatch test). My earlier test-hygiene habit of resetting `order_no_seq` to a hardcoded 1001 (safe when the DB was empty) had left the sequence at 1001 → the next real submit would have collided on the UNIQUE `order_no`. **Fixed:** `setval(order_no_seq, 1004, true)` → next order is 1005. Going forward I let the sequence advance naturally (D1 permits gaps) rather than reset it, now that real data exists.

**Open flags (cumulative):** No 🔴 blocking. **New:** 🟡 ㉘ (update_order_items reason for #3 — surface as an RPC change), 🟡 ㉙ (runbook anon-callable inaccuracy — security-adjacent doc fix). Carried: 🟡 ㉗(b) (owner-confirm), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** the M5 nav shell (3 tabs) — and fold ㉘/㉙ in (add `p_reason` to `update_order_items` when building the workbench Edit; fix the runbook's login-flow explanation).

---

## Review of a4f899 — fix(m5): ㉘/㉙ — update_order_items gains p_reason; correct runbook doc

**Verdict:** ✅ accept — both flags closed, the RPC change proven correct **end-to-end live**, and the snapshot-semantics pin still holds through the rewritten function. Also lands M5.2 (Realtime on `orders`).

**㉘ CLOSED — verified live (one rolled-back salesman+accountant transaction):**
- Migration applied: `update_order_items(p_order_id, p_notes, p_items, p_reason text DEFAULT NULL)`, **exactly one overload** (the 3-arg was `drop`ped, not left to shadow → no ambiguous-overload footgun). Types regenerated, `tsc` 0.
- **Salesman in-window edit still works** with no reason → `items_changed`, qty applied ✓ (the 4-arg default keeps the old 3-arg call site valid).
- **Accountant post-window edit WITHOUT reason → REJECTED** "reason is required to edit an order after its edit window has passed" ✓ (mandatory only for `edited_after_lock`).
- **Accountant post-window edit WITH reason → `edited_after_lock`, `details.reason='shop called, qty up'`** ✓ — and `describeEvent` already renders `details.reason`, so acceptance #3's "before/after **+ reason** in timeline" is now end-to-end real.
- **Snapshot pin intact:** re-priced the catalog +₹1000, then edited qty on the survivor → its `unit_price_paise` stayed **52300** (₹523, the original snapshot), before==after. The RPC UPDATEs only qty/line_total/position on survivors, never `unit_price_paise` — "price at order time is the deal" survives the rewrite. ✓

**㉙ CLOSED:** the runbook's "Why it's these steps" now reads client → **Server Action** → `email_for_username` via a **service-role** client, explicitly noting anon/authenticated have no grant since ㉑ (unreachable from the browser) — matches live grants. The spec (order-lifecycle.md) event catalog + editing table are updated to "reason **required**" (was `reason?`).

**M5.2 (Realtime):** `orders` added to the `supabase_realtime` publication (verified live) — the dashboard's ≤5s live list (acceptance #1) can subscribe to `postgres_changes`; Realtime honors RLS, so a salesman subscriber still only receives their own rows.

**Replay consistency:** the `drop` targets `update_order_items(uuid,text,jsonb)` created in 150800; the new file is timestamped `20260707T120000` (after the Jul-6 migrations + the Jul-7 username ones), so a fresh replay finds the 3-arg to drop and lands on the 4-arg — matches live. `grant execute … to authenticated` is fine (the body enforces role: salesman own+window, accountant/admin with mandatory reason past lock).

**Open flags (cumulative):** No 🔴 blocking. ㉘ ㉙ **closed** (this commit). Remaining: 🟡 ㉗(b) (owner-confirm), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Standing note: `retailer_quick_added` is still emitted by no RPC (from the M5-prompt review) — not a flag; revisit if the workbench timeline needs it.

**Next-commit suggestion:** the M5 nav shell / orders list — I'll verify the Realtime ≤5s path and the workbench edit-with-reason UI when they land.

---

## Review of f757b17 — feat(m5): nav shell + live orders list (S8)

**Verdict:** ✅ accept — a solid S8: correct RLS scoping, role-gated route, 3-tab responsive shell, sound Realtime design; `tsc` + `eslint` clean on the committed files. Three low 🟡 polish items (㉚), nothing blocking. *(A tree-wide lint failure I hit is from the BUILDER's **uncommitted** `OrderWorkbench.tsx` S9 WIP, not this commit — heads-up below.)*

**Verified (live + execution):**
- **RLS scoping is real:** `page.tsx` fetches orders with no ownership filter, relying on `orders_select_staff` (`auth_profile_role() IN ('accountant','admin')`, confirmed live) to show accountant/admin **every** order while `orders_select_own` scopes salesmen. The client never re-derives scope. ✓
- **Route is role-gated:** `middleware.ts` redirects a salesman off any `/dashboard*` route to `/` — the dashboard is accountant/admin-only, with RLS as the second wall. ✓
- **Realtime design is correct:** subscribes to `postgres_changes` INSERT/UPDATE on `orders` (M5.2 added it to the publication). INSERT **refetches the joined row by id through the RLS-scoped browser client** (defense in depth — raw payload lacks the joins, and the refetch re-gates on RLS) then prepends with a 5s flash; UPDATE patches status/total/editable_until/cancelled_by in place so a Mark-processed/Cancel/Edit from any open dashboard reflects without refresh. ✓
- **3-tab shell, no scope creep:** Orders/Retailers/Products only (no Dashboard/Inventory/Routes/Reports/**Users**); left rail on desktop, top strip + bottom tabs on phone (owner's responsive deviation); sign-out + who's-signed-in in chrome. ✓
- Money integer paise → `formatRupees`; IST timestamps + today/yesterday IST buckets (`istDateKey`, now `export`ed — the only `format.ts` change, no behavior shift); desktop table + mobile cards from the **same** filtered data (no second fetch). `tsc` 0, `eslint` 0 on the committed files. ✓

**🟡 ㉚ — three low S8-list polish items (non-blocking):**
1. **Arrow keys hijacked globally.** The `window` keydown handler `preventDefault`s ArrowUp/Down even when a `<select>` (salesman/date filter) or input is focused — so you can't keyboard-navigate those dropdowns. It already exempts the search input for `/`; do the same (skip when the target is a form control) for the arrows. [OrdersList.tsx:139](src/app/dashboard/OrdersList.tsx#L139).
2. **Salesman filter matches by name, not id.** `DashboardOrderRow` carries no `salesman_id`, so the filter maps the selected id→name and compares `profiles.full_name` — two salesmen sharing a name both match. Fine at 1–2 salesmen, but add `salesman_id` to the select and match by id (there's a dead `if (salesmanId !== "all") {}` at :113 documenting this).
3. **Realtime UPDATE leaves the line count stale.** An edit changing the number of lines patches `total_paise` (correct — the recompute trigger fires the UPDATE) but not `order_items.count` (a joined aggregate absent from the payload), so LINES can lag until refresh. Cheap fix: refetch the joined row on UPDATE too (as INSERT does).

**Couldn't verify headless:** the actual **≤5s wall-clock** of criterion #1 (needs a live browser + a real cross-session INSERT). The plumbing is correct and RLS-safe (publication ✓, RLS ✓, RLS-scoped refetch ✓); I'll time it when I next drive a real session, or the owner can eyeball phone→dashboard.

**Heads-up (NOT this commit):** your uncommitted `dashboard/orders/[id]/OrderWorkbench.tsx` (S9 WIP) has a `react/no-unescaped-entities` error at line 370 (unescaped `'`) — it'll fail the lint gate when you commit S9. Escape it (`&apos;`) first.

**Open flags (cumulative):** No 🔴 blocking. **New:** 🟡 ㉚ (S8-list polish ×3). Remaining: 🟡 ㉗(b) (owner-confirm), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** S9 order workbench (detail + Mark processed / Edit-with-reason / Cancel / Print) — I'll drive `process_order` + edit-with-reason live there; fix that lint error before committing.

---

## Review of 7a475de — fix(m5): ㉚ — orders-list polish (arrow keys, salesman filter, live update)

**Verdict:** ✅ accept — all three ㉚ items fixed correctly; the ㉚ files are `tsc`-clean and the tree `eslint`-clean. **㉚ CLOSED.**

- **㉚.1 arrow hijack:** the keydown handler now computes `isFormField` (target is INPUT/SELECT/TEXTAREA) and gates ArrowUp/Down with `&& !isFormField`, so native `<select>`/input navigation works again; row-nav arrows fire only at page level. (`/` and `Enter` unchanged — Enter-from-search still opens the top result, which is fine.) ✓
- **㉚.2 salesman filter by id:** `salesman_id` added to the orders select **and** the realtime `ORDERS_SELECT` (kept consistent so refetched rows carry it); `DashboardOrderRow` gains `salesman_id`; filter is now `o.salesman_id !== salesmanId`. Name-matching hack + dead `if` block removed; the two-stage `filtered`/`finalFiltered` collapsed to one pass. ✓
- **㉚.3 live line-count:** `handleUpdate` refetches the joined row by id (same RLS-scoped path as INSERT) instead of patching scalars, so `order_items(count)` no longer goes stale after an edit; `RawOrderUpdate` removed. ✓

`tsc` shows no errors in `OrdersList.tsx`/`dashboard/page.tsx` (the lone `TS2307` is from the **untracked** S11 `dashboard/retailers/` WIP — not this commit); `eslint` exit 0.

**Open flags:** No 🔴 blocking. ㉚ **closed**. Remaining: 🟡 ㉗(b) (owner-confirm), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** already in flight — S9 workbench + S10 pick slip (0c19fae). I'll drive `process_order` + edit-with-reason live there.

---

## Review of 0c19fae — feat(m5): order workbench (S9) + print pick slip (S10)

**Verdict:** ✅ accept — a faithful S9 workbench + S10 pick slip; all writes go through the RPCs I proved live, the FK embeds resolve, snapshot semantics hold, and the print view matches the spec. `eslint` + `tsc` clean on the tree. One low UX nit (no flag).

**S9 workbench — verified:**
- **Actions map to the right RPCs:** Mark processed (submitted only, confirm sheet) → `processOrder` → `process_order`; Edit → `updateOrderItems(id, notes, items, reason?)`; Cancel (reason **required**) → `cancelOrder(id, reason)`. New `processOrder` wrapper calls `rpc("process_order", { p_order_id })` through the offline-aware `callRpc`, matching the live signature. I proved all three RPCs live earlier (process_order rejects salesmen + does submitted→processed; update_order_items reason mandatory past lock; cancel needs reason). ✓
- **Edit-with-reason is correct:** `requiresReason = mode==='edit' && !editable` (`editable = submitted && editableUntil>now`), `handleSave` blocks on an empty reason and passes `reason` only when required — so an in-window edit logs `items_changed` (no reason) and a post-lock edit logs `edited_after_lock` with the reason. Mirrors the RPC's own guard (defense in depth). ✓
- **FK embeds resolve:** the multi-join (`salesman:profiles!orders_salesman_id_fkey`, `processed_by_profile:!orders_processed_by_fkey`, `cancelled_by_profile:!orders_cancelled_by_fkey`) — all three constraint names exist live, so the page won't 500. ✓
- **Snapshot + D2:** existing lines render/submit at their `order_items` snapshot price (survivors keep it); add-item search is filtered to `active && price_paise !== null` (D2). Money integer paise → `formatRupees`; "Total (incl. GST)", no tax row (D5). HISTORY via the shared `describeEvent`. ✓
- **The lint error I flagged is fixed** — [OrderWorkbench.tsx:376](src/app/dashboard/orders/[id]/OrderWorkbench.tsx#L376) now uses `&apos;`; `eslint` exit 0.

**S10 pick slip — verified:**
- Print-CSS only (no PDF lib): `@media print` + `@page { size: A4 }`; **QTY column first** at `font-size: 30px` (godown-readable ≥16pt); item `product_name` verbatim, no truncate/ellipsis rule (wraps, never clipped). Prices **off by default**; the toggle flips the badge **PICK SLIP → ORDER COPY** (so paper can't be misfiled) and reveals RATE/AMOUNT + "Total (incl. GST)" (no tax line). Notes boxed, dropped if empty; Packed-by/Checked-by rules; footer uses the new `formatFullTimestamp` (always-full IST date+time — right call, paper has no relative "now"). RLS-scoped data page under the role-gated `/dashboard`. ✓

**Low nit (no flag):** the workbench freezes `now` at mount (no interval), so if the 2h window lapses while it's open, the client still thinks `editable` and hides the reason field — but a save then hits the server's `edited_after_lock` guard and is **rejected with "reason is required"** (no silent bypass; the accountant refreshes and the reason field appears). Self-correcting, rare, safe — noting only.

**Open flags:** No 🔴 blocking; only 🟡 ㉗(b) (owner-confirm). ㉚ closed.

**Next-commit suggestion:** already landed — S11 retailers (711ef1d) + Products pricing (983554a); I'll verify the verify-flow + the TBD-price→salesman-visible criterion (#6) live there.

---

## Review of 711ef1d — feat(m5): retailer verification queue (S11)

**Verdict:** ✅ accept — a clean S11: pending-first queue, verify-by-editing in one motion, deactivate-never-delete, correct RLS-scoped writes. `eslint` clean. No new flags.

**Verified:**
- **Verify flow = fix-the-name (acceptance #5):** tabs all/pending/verified/deactivated (default pending = `active && !verified`); a pending row opens **straight into inline edit**; `saveAndVerify` writes `{name, area, phone, verified:true}` in one Save — fixing the canonical spelling *is* the verification, and the helper text pins why (future Tally-ledger mapping). NEW badge clears once `verified` flips. ✓
- **Order history preserved:** verification only mutates the `retailers` row; orders reference `retailer_id` (unchanged), so a verified shop's past orders stay intact. ✓
- **Deactivate, never delete:** `setActive(id,false/true)` toggles `active`; deactivated rows dim + show Reactivate; no DELETE path anywhere. ✓
- **Writes are correctly RLS-scoped, not RPC:** direct `supabase.from("retailers").update(...)` via the browser client — retailers aren't in the RPC-only set (orders/order_items/order_events are), and `retailers_staff_update` (accountant/admin, verified live) authorizes it; a salesman has no UPDATE policy (default-deny) and can't reach `/dashboard` anyway. The page fetches all retailers under accountant RLS. ✓
- Good a11y on the clickable pending row (role=button, tabIndex, Enter/Space); `rowActions` `stopPropagation` so Edit/Deactivate don't also trigger the row's open-edit. `eslint` exit 0.

**Minor (no flag):** the page comment says accountant/admin have "RLS ALL" on retailers — it's actually SELECT+INSERT+UPDATE (no DELETE, by the deactivate-not-delete design); functionally fine, just imprecise wording.

**Open flags:** No 🔴 blocking; only 🟡 ㉗(b) (owner-confirm).

**Next-commit suggestion:** already landed — Products pricing (983554a); I'll drive criterion #6 (set a TBD price → salesman sees the SKU) live.

---

## Review of 983554a — feat(m5): products pricing tab (owner-added deliverable)

**Verdict:** ✅ accept — the owner-added Products tab, with **acceptance #6 proven live end-to-end**. Spec deviations recorded with changelog discipline; `eslint` clean.

**Acceptance #6 — verified live (rolled-back RLS transaction):** on a real TBD SKU (`ZEB-EAR-05`): `salesman_sees_before = false` (D2 hides unpriced), the **accountant's UPDATE affected 1 row** (`products_staff_update` authorizes it), and `salesman_sees_after = true` — the salesman sees the SKU the instant a price is set, no deploy. Rolled back, so the SKU stays TBD. ✓ This is exactly criterion #6 ("set a TBD price → the newly-priced SKU shows in Quick Order").

**Verified by reading + live RLS:**
- **All SKUs, incl. TBD/inactive:** `page.tsx` fetches every product (`products_select_staff` returns all — unlike the salesman's active+priced filter), ordered by category then name (the client's consecutive-category grouping relies on that). TBD + INACTIVE badges. ✓
- **Money is correct:** input is whole ₹ rupees, validated `/^\d+$/` (rejects non-integer/negative **before** the write), stored as integer **paise** (`×100`); blank = TBD (`null`); paise→rupees on edit. The `₹0` edge is caught by the DB `price_paise > 0` check (surfaced as an error). ✓
- **RLS-scoped direct UPDATE** (not RPC — products/retailers aren't in the RPC-only set): `supabase.from("products").update({price_paise, tally_name, active})`, authorized by `products_staff_update` (accountant/admin; a salesman has no update policy). ✓
- **Spec updated same-commit (changelog discipline, per the M5 prompt §0):** accountant-dashboard.md §5 rewritten from "deferred to Supabase Studio" to the in-app screen, and §Non-functional records the phone/responsive override. Both owner deviations now live in the spec. ✓

**Open flags:** No 🔴 blocking; only 🟡 ㉗(b) (owner-confirm). All 7 M5 acceptance criteria now have reviewer coverage — #1 (Realtime plumbing, wall-clock pending a live session), #2 (`process_order` rejects salesman — proven), #3 (post-lock edit reason — proven), #4 (A4 print-CSS + qty size), #5 (verify-by-edit + history preserved), #6 (TBD→visible — **proven live**), #7 (responsive on phone).

**Next-commit suggestion:** the retailer-row-wrap CSS fix (6d9d01e) is next in my queue.

---

## Review of 6d9d01e — fix(m5): wrap the retailer row on narrow viewports

**Verdict:** ✅ accept — trivial, correct 1-line CSS. Adds `flex-wrap: wrap` to `.row` in RetailersQueue.module.css so the name/meta + Edit/Deactivate actions wrap to a second line on phone-width instead of squeezing/overflowing — matches the phone-usability override (accountant-dashboard.md §Non-functional). No logic/behavior change; nothing else touched.

**Open flags:** No 🔴 blocking; only 🟡 ㉗(b) (owner-confirm). M5 dashboard (Orders live list · workbench · pick slip · Retailers queue · Products pricing) is now fully reviewed.

**Next-commit suggestion:** M5 is functionally complete — a "mark M5 done in PLAN" docs pass, or the deferred items (airplane-mode drill, real-UI login drive, ㉗(b) decision). Happy to drive a live browser session to nail the wall-clock criteria (#1 ≤5s, #4 A4 print, #7 phone) once given a throwaway login.

---

## Review of 650a816 — docs: mark M5 complete in PLAN; record D10 (real staff names in order history)

**Verdict:** ✅ accept — docs-only (PLAN.md + decisions.md), accurate against my reviews; closes ㉗(b) via D10.

**Cross-checked:**
- **M5 marked ✅ Done** with detail matching what I reviewed and proved live: Orders (S8 list + S9 workbench + S10 pick-slip) · Retailers (S11) · Products pricing, 3-tab desktop+phone, Realtime, post-lock `p_reason`, TBD→salesman-visible. The RPC/RLS claims are the ones I verified live (process_order rejects salesman, edit-reason enforced, #6 visibility flip). Now-line advanced to **M6 — deploy + pilot**; this lands all Phase-1 app screens. ✓
- **D10 recorded** (decisions.md): owner confirms **real staff names** in HISTORY over a generic "the office" — well-reasoned (3–4-person family op; "Vikram edited this" beats "the office"; no code change; revisit + tighten `profiles_select_active` if the team grows). Mechanism described accurately (profiles_select_active lets staff read the directory; describeEvent falls back to "the office" only when no name resolves). **Closes 🟡 ㉗(b).** ✓

**One soft note (same shape as the M4 "Done" caveat):** the M5 row says "all reviewer-verified live." Precisely — the RPC/RLS correctness is live-proven, but three criteria have a browser/device half I can't drive headless: #1's ≤5s **wall-clock**, #4's **actual A4 print**, #7's **phone feel**. Mechanisms are verified (Realtime + RLS, print-CSS `@page A4` / 30px qty, responsive layouts); the wall-clock/visual confirmation awaits a live session (standing offer). Not drift — just calibrating "verified live" to "server guarantees proven; pixels/latency await a device."

**Open flags:** No 🔴 blocking. ㉗(b) **closed** (D10). Remaining: 🟡 ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨ — the go-live hardening/checklist set.

**Next:** M6 (deploy + pilot). Pre-pilot checklist worth surfacing: ⑯ (leaked-password toggle), ㉒ (SUPABASE_SECRET_KEY in Vercel env), ㉛ (sequence grants), and driving the deferred live drills (airplane-mode, real login, ≤5s/print/phone).

---

## Review of db3bd07 — docs: capture Phase-3 multi-brand design note + reference it from PLAN

**Verdict:** ✅ accept — a forward-looking (**not-built**) Phase-3 design note; every premise checks out live, it's internally consistent, and it correctly flags that it revises D4 at build time. No code, no new open items.

**Premises verified live:**
- "Schema is already multi-brand-ready" — `products.brand_id` is **NOT NULL** with **0** rows missing a brand; `brands` holds exactly **Zebronics**. So multi-brand is genuinely additive (D4). ✓
- "The one real schema change is `orders.brand_id`" — confirmed **absent** today (brand is only derivable from items, D4's Phase-1 stance); `brands.code` also **absent** — so "add these" is accurate, not a duplicate. Backfill existing orders → Zebronics is correct (only brand). ✓

**Design is sound + consistent:**
- One-order-one-brand enforced **server-side** in `submit_order`/`update_order_items` (each line's `product.brand_id` must equal `orders.brand_id`) — right layer, matches the RPC-only write model + "reject in the RPC, not just the UI." ✓
- **Ref numbering — Option A** (global `order_no_seq` + brand code, `ORD-ZEB-2026-1042`) recommended over B (per-brand counters). A is the correct call: `order_no` stays globally unique + monotonic (gaps fine, D1), so a spoken/printed number is unambiguous across brands; B needs `unique(brand_id, order_no)` + per-brand counters. Left as an **owner-pending** decision, with a note to **record a D4 revision** at build — good discipline, doesn't silently contradict D4. ✓
- "Number doesn't reset annually (D1); avoid a per-year/per-brand-per-year axis" — accurate (the year is a cosmetic label, not a counter reset). "What does NOT change" (snapshots, RLS, integer paise, lifecycle) — correct; multi-brand = data + one migration. ✓

**PLAN link:** Phase 3's goal line now points at the note and drops the stale "order refs stay brand-free" (which Option A revises) — consistent, no leftover contradiction. ✓

**Open flags:** none new — a not-built design note. The A-vs-B ref-numbering choice is parked as a **Phase-3-time owner decision**, not a current open item. No 🔴 blocking; standing deferred set unchanged (㉛, ⑯, ⑬, ⑭, ⑦⑧⑨).

**Next:** M6 (deploy + pilot) whenever it starts.

---

## Review of 0a9c77e — docs: builder fix-prompt for dashboard UX (stale-after-save, loading, verify button, tally-name default)

**Verdict:** ✅ accept — an accurate fix-prompt; all four diagnoses check out against the actual code and the fixes are the right patterns. **🅐 is a real bug I missed** in my 711ef1d (S11) + 983554a (Products) reviews — owned below. Tracking the set as 🟡 ㉜ until the fix lands.

**🅐 stale-after-save — CONFIRMED, and my miss.** `RetailersQueue` ([:23](src/app/dashboard/retailers/RetailersQueue.tsx#L23)) and `ProductsPricing` ([:23](src/app/dashboard/products/ProductsPricing.tsx#L23)) hold server data in `const [x] = useState(initialX)` with **no setter**. After a write they call `router.refresh()` — which in the App Router re-renders the client component **preserving its React state**, so the fresh `initialX` prop is ignored and the row shows the frozen original until a full reload. In both reviews I verified the **DB write + RLS live** (correct — the data really updates; I even proved #6's visibility flip), but I did **not** trace that the frozen `useState` swallows the refresh, so the screen looks broken. Genuine review miss — the owner caught it in testing. Prescribed fix (render from the prop; keep only UI state `editingId`/`form`/`saving`/`tab`) is correct. ✓
- Prompt's own caveat that `OrderWorkbench` "renders from props — confirm after Mark-processed/Cancel" is right: its status/actions read `order.*` props directly (so status changes reflect), only the edit `items` sit in `useState` (set by the user during edit), so it happens to be OK — worth the double-check they flag.

**🅑 loading feedback — accurate.** Deactivate/Reactivate/Edit get only `disabled={saving}` (no spinner), and `saving` flips false the instant the `await` returns — *before* `router.refresh()` repaints — a dead gap. Fix (per-action spinner + `useTransition`/`isPending` to stay busy through the refresh) is the correct modern pattern. ✓

**🅒 hidden verify — accurate.** A pending row shows only Edit + Deactivate; verifying needs knowing to click the row/Edit → "Save & verify." An explicit accent **"Review & verify"** primary action is a fair discoverability fix; correctly **no RLS change** (accountant/admin already verify; salesmen only add unverified). My S11 review described the flow as working (it is) but didn't flag the discoverability gap. ✓

**🅓 tally-name default — sound.** Keep `tally_name` nullable, **fall back to `products.name` on read** (display + Phase-2 export), and **don't copy** the name into the column — preserving "explicitly mapped vs defaulted" for Phase-2 QA is exactly right; placeholder shows the default. ✓

All cited line refs are accurate; no spec violations; the "don't re-introduce frozen `useState`, don't copy tally_name, don't touch RLS" guards are good.

**Open flags:** **New 🟡 ㉜** (dashboard-UX: 🅐 stale-after-save [real bug, my miss] · 🅑 loading · 🅒 verify button · 🅓 tally default) — fix before prod. No 🔴 blocking. Carried: ㉛ ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next-commit suggestion:** the fixes themselves — I'll confirm the frozen `useState` is gone (render derives from props) and re-verify the write paths + #6 still hold.

---

## Review of f75937c — docs: capture role/job overview + D11 (admin/accountant parity is deliberate)

**Verdict:** ✅ accept — an accurate plain-language role overview + a sound, well-reasoned D11. One minor completeness note on D11's enumeration.

**Verified accurate:**
- The "day to day" descriptions match what I've verified across M1–M5: salesman in the RLS-scoped, RPC-only mobile order flow; accountant in the dashboard queue/workbench/pricing/verify/pick-slips; admin as oversight/escalation + provisioning. ✓
- **D11's core claim holds:** the four order RPCs (`submit_order` salesman-only; `process_order`/`update_order_items`/`cancel_order` gated on `v_role in ('accountant','admin')`) have **no admin-only branch** — read all four; admin and accountant are treated identically, and the dashboard nav/UI doesn't branch on role. So "admin = oversight only" is genuinely an org convention, not enforced — accurate, and a good thing to record deliberately (so it's not mistaken for a bug). ✓

**Minor completeness note (serves D11's own purpose):** D11 says the *only* admin-vs-accountant difference is "outside the app entirely: creating users and setting `profiles.role`/`username`." It misses one **in-DB** admin-exclusive grant: **`products_admin_insert`** (RLS: `INSERT` on `products` is admin-only; accountant has only `products_staff_update`). It's dormant — no in-app add-product path, and the seed runs as `service_role` — which is exactly why it's easy to overlook. Since D11 exists so this asymmetry "isn't rediscovered as a bug later," the record is more complete if it lists `products_admin_insert` alongside the user/role items. (`profiles_update_admin` — the role-change path — is already covered by "setting `profiles.role`.") Suggestion only; the decision itself is sound.

**Open flags:** none new — docs. No 🔴 blocking; carried 🟡 ㉜ (dashboard-UX, fix before prod), ㉛ ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** the ㉜ dashboard-UX fix commit is what I'm watching for.

---
