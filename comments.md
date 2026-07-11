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

**No 🔴 blocking items open.** (🔴 ㊲ — the "Calvin Klein" (CK) test brand pollution — was raised at c3/merge and **CLOSED 2026-07-08**: CK brand + products removed cleanly (verified live: 0 CK brands, 0 orphan products); separately a **real** Luminous brand (LUM, ~99 real inverter/UPS products, owner-confirmed) was onboarded, so `multiBrand` is now *correctly* on — the dashboard/Quick-Order brand UI serves real Zebronics+Luminous data, not test pollution. 🔴 ㊱ — `submit_order` `min(uuid)` crash — closed at 17c9956.) All other items are minor / deferred / owner-config. M1 backend + M2 seed verified complete against the live project; M4 (salesman order flow) is **complete and reviewer-verified** — infra (96880f5), S3–S6 create (97272b4), S7 detail/edit/cancel/history (9ccac24), all live-verified (idempotent submit, double-tap→one row, server post-expiry reject, `order_events` reconstruction). Flags ㉓ ㉔ ㉕ ㉖ ㉗(a) **all closed** via the builder's fix commits (48ed20f, 48913ec). **M5 (accountant dashboard) kicked off** (prompt 03b7fa0); ㉘ (edit-reason RPC) + ㉙ (runbook) **closed** at a4f899 — `update_order_items` now takes a mandatory-past-lock `p_reason` (verified live end-to-end: salesman path intact, post-window reason enforced, snapshot pin holds), and Realtime is enabled on `orders`. S8 dashboard (nav shell + live orders list, f757b17) landed; ㉚ (3 polish items) **closed** at 7a475de. **M5 (accountant dashboard) complete and reviewer-verified** — S8 list · S9 workbench · S10 pick-slip · S11 retailers · Products pricing; #2 (process_order rejects salesman), #3 (post-lock edit-reason), #6 (TBD→salesman-visible) **proven live**; #1/#4/#7 wall-clock/print/phone await a live browser. **㉗(b) closed** (D10 — owner confirms real staff names). PLAN Now-line → M6 (deploy + pilot). ㉜ **closed** at f5c62eb (dashboard-UX: render-from-prop + loading + verify button + tally default; 🅐 was a REVIEWER miss, now fixed). **M5.5 catalog-admin (fixed-price Add + Excel import) kicked off** — design resolutions + 4-commit builder prompt at b87f057; its "current state" claims (products schema, 42 rows/34 priced, 6 categories, `products_admin_insert`=admin-only INSERT, `products_staff_update`=accountant+admin UPDATE, `unique(brand_id, tally_name)` applies cleanly — `tally_name` already 0 nulls, no collisions) **all verified live**; flag ㉞ pinned the one wrinkle and the builder **closed it at fe1bef9** (prompt now recreates `update_order_items` only, from the current 4-arg `p_reason` body, not the superseded copies; RLS wording corrected). **M5.5 c1 landed + reviewer-verified live (1e81d48)** — migration applied: `sku` dropped, `tally_name` NOT NULL, `unique(brand_id, tally_name)` key (dup-reject proven); the audit swap proven via a **rolled-back** admin edit on a real order (emits `tally_name`, no `sku`, ㉘ reason-guard intact); ㉞'s corrected plan implemented exactly; tsc/eslint/build clean. **M5.5 c2 (01e575d, ledger) + c3 (26005d5, Add/Edit modal) reviewer-verified** — c3's `parsePricePaise`/normalize node-tested (21 cases), admin-only Add server-enforced (accountant INSERT RLS-blocked, proven live), upsert-on-`(brand_id, tally_name)`; new 🟡 ㉟ (accountant name/category read-only is UI-only — DB allows it, owner's call). **M5.5 c4 (52dcf8a, Excel import wizard) reviewer-verified** — `import_products` RPC proven live (admin-only re-check, atomic single-txn upsert, `xmax=0` added/updated split, idempotent re-run = all Updated, never-deletes); **M5.5 c1–c4 all ✅ accept**; c4's `20260707T180000_import_products.sql` joins the ㉝ set. **㉟ closed at dfd8a46** (documented in the roles doc + RLS matrix, tied to D11, owner leaves as-is; `BEFORE UPDATE` trigger enforcement path noted but unbuilt). **M5.5 complete + documented.** **Phase 3a (fixed-price multi-brand order flow) design+prompt kicked off (76a817f) — reviewer-verified accurate** — schema state, current `order_ref` format + `submit_order` body, `order_no_seq`, reused `FilterDropdown`/`SalesmanFilter`, 4-arg RPC sigs all verified live; backward-compat (derive `brand_id` server-side, unchanged signatures so deployed `main` keeps working on the shared DB) is coherent; Commit-1 migration pre-checked safe (7 orders, 0 zero-item, 0 mixed-brand, `order_ref` already unique). Watch at build: shared-DB test-brand cleanup (c2), `submit_order` guard placement (c1), `_multi_brand.sql` joins ㉝. **Phase-3a c1 landed (a101f55) — ❌ REJECT: DDL + `update_order_items` verified correct live, but `submit_order` crashed on `min(uuid)` → 🔴 ㊱ production submit DOWN. Builder fixed it in the very next commit (17c9956) — `array_agg(distinct brand_id)[1]`; I re-verified live (submit → `ORD-ZEB-2026-1010`, brand set, submitted; mixed-brand rejected) → 🔴 ㊱ CLOSED, submission restored. c2 (029ffa4, Quick Order brand UI) ✅ (single-brand path provably unchanged, test-brand hygiene then respected). bf0ad3b (future-plans docs) ✅. **c3 (94c6556, dashboard brand column/filter/detail/pick-slip) — ❌ REJECT: code correct + verified, but the builder left a "Calvin Klein" (CK) test brand + 3 active priced products in the LIVE catalog → 🔴 ㊲; must remove before anything else lands.** c4 (e544d5b, Products mobile Brand▸Category grouping + card de-dup) ⚠️ **accept-with-followups — code correct + verified (tsc/eslint/build clean, ㉜🅐/🅑 + row-click preserved, desktop unchanged), but rides the same ㊲ pollution (its brand tier only renders because CK is live); ㊲ still gating.** **Phase-3a c1–c4 code all sound; the one open blocker is ㊲ (remove the CK test brand).** **Phase-3a merged into `main` (34d6231) — ✅ clean integration (empty diff vs reviewed feature tip, no conflicts, migrations + ㊱ fix present, tsc clean), BUT it promoted the phase to the *deployed* branch with 🔴 ㊲ still open (now 4 CK products) → deployed app surfaces the pollution; ㊲ cleanup now urgent.** **㊲ CLOSED 2026-07-08** (CK test brand removed cleanly, verified; Luminous onboarded as a real 2nd brand — Phase-3a multi-brand now serves real data, c1–c4 complete). **Phase-3b (LG manual pricing + admin approval) prompt kicked off (dc04359) — reviewer-verified accurate** (status CHECK, absent columns, exact `products_select_salesman` qual, guard edges, both brands fixed all verified live); ✅ accept; watch at Commit 1: editability predicate must include `pending_approval`, `cancel_order` must accept pending/approved, and verify fixed-brand price untamperability + D2-preserved RLS relax by execution. **Phase-3b c1 (7bf7679, backend) — ✅ accept, verified end-to-end by execution:** fixed-brand untamperability holds (Zebronics bogus client price → stored catalog ₹523), full LG lifecycle proven (pending→admin-approve→process; process-pending & non-admin→approved rejected), RLS D2 preserved (manual unpriced visible / fixed unpriced hidden), **both watch-items addressed** (pending is salesman-editable; accountant cancel-reject works), ㉘/㉞ intact, **no test-brand left** (clean rolled-back probes), tsc clean. **c2 (1965c7a, Quick Order collapse-to-reveal + manual-price entry) ⚠️ accept-with-followups** — code correct + verified (build/eslint clean; collapse Set, manual `parsePricePaise` input, null-price handling, cart→submit price plumbing on the c1 contract, shared pending/approved chips), BUT the builder provisioned a live **LG** brand + 4 AC/fridge products on the shared prod DB for testing → 🟡 ㊳ (salesman-visible; owner-confirm real-LG-onboarding vs test-data; 2nd provision-on-prod after ㊲). **c3 (fa77bd5, dashboard Pending-approval tab + admin Approve) ✅ accept** — tab folds into the scoped counts, `STATUS_LABEL` fixes the label, **admin-only Approve triple-enforced** (UI-hidden for accountant + `approve_order` role check + guard trigger — server denial proven live at c1), Mark-processed gated to submitted/approved, workbench editable window extended to pending_approval; tsc/eslint/build clean. **Phase-3b c1–c3 complete** (backend proven by execution; salesman collapse+manual-price UI; dashboard approval). **㊳ CLOSED — owner: leave the current brands; the DB is pre-handover DEV, not live prod (no real users until the client walkthrough), so test/real brands during dev are fine — data-hygiene flags downgraded going forward (memory `pre-handover-dev-state`); reconcile the catalog to a clean state before handover.** **㉝ CLOSED at 670ad93** (22 migration filenames reconciled 1:1 to the `schema_migrations` ledger; a `db push --dry-run` is the final pre-deploy confirmation). Open: 🟡 ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. **Note (branch/merge):** Phase-3b was reviewed on `feature/phase3b-lg-manual-approval` then merged to `main` (af20a5a); all phase3b review blocks came across. **Live-DB note (2026-07-08):** catalog is now **2 real brands** — Zebronics (44) + Luminous (99, real inverter/UPS, likely M5.5-imported); the CK test brand is gone. **`orders` table is now empty (0)** — was 8; looks like an owner reset for real use (order_no_seq keeps advancing, gaps fine per D1 — never reset it). Confirm the wipe was intentional.

| Flag | Item | Severity | Origin | Status |
|---|---|---|---|---|
| ㊳ | **LG brand provisioned on the shared prod DB for c2 testing (owner-confirm).** Phase-3b c2 (1965c7a) — the builder added a live **LG** brand (`pricing_mode='manual'`, `requires_approval=true`) + **4 products** (LG 1.5-Ton AC, 2-Ton Split AC, 260L/340L fridges, all null-price). Because c1's RLS relax shows unpriced *manual* products, these are **salesman-visible**, and multiBrand flips to 3 on the deployed app. Commit calls it "temp for testing," but **LG is the real Phase-3b target brand** and the products are realistic — so this is plausibly intentional onboarding, NOT clearly-fake pollution like CK/㊲. **Owner call:** keep (real LG onboarding) or remove (test data — safe, `lg_orders=0`/`lg_order_items=0`). Recurring provision-on-prod pattern (2nd after ㊲) — recommend a Supabase dev branch or sign-off. | 🟡 owner-confirm / data-hygiene | reviewer 2026-07-08 (live catalog probe) | ✅ **CLOSED 2026-07-08 — owner: "let the current ones be for now."** Key reframe: **the DB is pre-handover DEV, not live prod** — the app hasn't been handed to the client yet, so there are no real salesmen; test/real brands during dev are fine. Downgrade the data-hygiene severity accordingly (see memory `pre-handover-dev-state`). Pre-handover checklist item: reconcile the catalog/orders to a clean real state before the client walkthrough. |
| ㊲ | **CK test brand left in the LIVE catalog (Phase-3a c3, 94c6556).** To exercise the multi-brand paths, the builder added a **"Calvin Klein" (code CK, active)** brand + **3 active, priced products** (Obsession/Eternity/Sense) — and left them in the owner's **live** shared catalog. Proven live: `brand_count=2`, `salesman_visible_nonzeb=3`, `salesman_visible_brand_count=2`. Impact on the owner's live system: the fake products show in the salesman Quick Order (`products_select_salesman` = active AND priced); `multiBrand` flips true so the c2 brand dropdown + Brand▸Category grouping render for real salesmen; the dashboard BRAND column/filter show. The prompt required a **disposable brand on a dev branch / removed afterward** — this violates it. **Safe to remove** (`ck_orders=0`, `ck_order_items=0`): delete the products + brand, or `active=false`. Reviewer did NOT mutate prod. **Update:** grew to **4** CK products, and Phase-3a was **merged into `main` (34d6231)** with ㊲ still open → the **deployed** app surfaced the pollution. | 🔴 **BLOCKING** — live-catalog pollution (now on deployed main) | reviewer 2026-07-07 (live catalog probe) | ✅ **CLOSED 2026-07-08** — CK brand + products removed cleanly (verified live: `ck_brands_left=0`, `orphan_products=0`). Separately a **real** Luminous brand (owner-confirmed, ~99 real products) was onboarded, so multi-brand is now correctly active on real Zebronics+Luminous data. |
| ㊱ | **`submit_order` crashes on `min(uuid)` — production order submission DOWN (Phase-3a c1, a101f55).** The recreated `submit_order` derives the order brand via `select count(distinct p.brand_id), min(p.brand_id) …` — but this Postgres has **no `min(uuid)` aggregate**, so **every** new-order submit throws `function min(uuid) does not exist` (proven live: single-brand 2-item probe **and** plain 1-item probe both crash; `select min(brand_id) from products` confirms the aggregate is absent). Runs after the idempotency early-return, so all genuinely-new submissions fail on the shared live DB the owner is testing Zebronics on. DDL (brands.code, orders.brand_id) + `update_order_items` are fine — only this function body is wrong. **Fix:** recreate `submit_order` (same signature) with `(array_agg(distinct p.brand_id))[1]` (or `max(p.brand_id::text)::uuid`) — both verified live. | 🔴 **BLOCKING** — prod-down | reviewer 2026-07-07 (live rolled-back submit probe) | ✅ **CLOSED** at 17c9956 — recreated `submit_order` with `array_agg(distinct p.brand_id)[1]`; re-verified live (single-brand submit → `ORD-ZEB-2026-1010`, `brand_id`=Zebronics, submitted; mixed-brand rejected; residual `min(` is only the fix comment). Submission restored. |
| ㉟ | **Accountant name/category "read-only" (M5.5 c3, 26005d5) is UI-only.** The Add/Edit modal disables + omits name/category from the accountant's UPDATE payload, so *through the app* an accountant can't rename/recategorize — but `products_staff_update` (USING/CHECK `role in (accountant, admin)`) grants an accountant UPDATE on **any** column, so a direct API call could. **Proven live** (rolled back): as the accountant, `update products set name=…` applied. Admin-only INSERT (Add) **is** server-enforced (accountant INSERT → RLS-blocked, proven). Fine for a trusted back-office role + matches the app's row-level (not column-level) posture; hardening = a column GRANT or a trigger/RPC rejecting staff name/category changes. | 🟡 UI-vs-DB enforcement gap | reviewer 2026-07-07 (live RLS probe) | ✅ **CLOSED** at dfd8a46 — recorded in the roles doc + RLS matrix, tied to D11 (separation is convention, not enforcement); owner leaves as-is; real enforcement = a `BEFORE UPDATE` trigger on `auth_profile_role()='accountant'` (unbuilt, nothing relies on it). |
| ㉞ | **M5.5 catalog-admin prompt (b87f057) — audit-payload swap framing.** The prompt says the order RPCs emit `jsonb_build_object('sku', …)` in "**4 places** across 2 files" (`_rpcs.sql` L166/L219 + `_update_order_items_reason.sql` L77/L127) and to "recreate the order RPCs." **Live truth (verified via `pg_get_functiondef`):** `'sku'` is emitted in exactly **2 sites, both inside ONE function `update_order_items`** (before+after snapshots); `submit_order`/`process_order`/`cancel_order` emit **0**. All 6 grep sites (incl. 2 more in `_rename_current_role.sql` L163/L213 the prompt omits) are the *same* function across three superseding defs. At Commit 1 the builder must: (a) `create or replace` **only `update_order_items`**, not `submit_order`; (b) copy from the **current** body `20260707T120000_update_order_items_reason.sql` (4-arg, with `p_reason`) — **NOT** `_rpcs.sql`'s stale 3-arg body, or the mandatory-reason logic (㉘) regresses; (c) put the swap in the NEW migration only, never edit an applied file. | 🟡 prompt-accuracy / Commit-1 watch-item | reviewer 2026-07-07 (live `pg_get_functiondef` audit) | ✅ **CLOSED** at fe1bef9 — prompt + design-doc now recreate `update_order_items` **only**, from the current 4-arg `p_reason` body (not the superseded `_rpcs.sql` / `_rename_current_role.sql` copies), swapping its 2 `sku` sites; `submit_order` left untouched; "RLS ALL" wording corrected to INSERT+UPDATE+SELECT (no DELETE). All re-verified against live. |
| ㉝ | **Migration file/version reconciliation before M6 deploy.** Recent migrations were applied via MCP `apply_migration` (recorded UTC-time versions in `schema_migrations`: `…071615`/`…071620`/`…091019`), but the committed files use a non-standard `T`-timestamp format (`20260707T120000_…` etc.) matching none of them. Runtime is fine (SQL applied + correct); risk is at deploy — a `supabase db push` from these files could mis-parse/re-order/re-apply (e.g. `realtime_orders`' `alter publication … add table` errors "already a member"). Dry-run `db push` onto a throwaway branch before prod; if it misbehaves, rename to 14-digit timestamps + `supabase migration repair`. Pre-existing pattern since M1; surfaced verifying ec94d06. **M5.5 c1's `20260707T170000_catalog_admin.sql` (1e81d48) joins this set** — same T-timestamp/MCP pattern, and its DDL is non-idempotent (`drop column sku` / `add constraint` error on re-apply), so the dry-run must confirm applied migrations aren't re-run. **M5.5 c4's `20260707T180000_import_products.sql` (52dcf8a) also joins the set** (adds the `import_products` RPC; `create or replace` so re-apply is safe, but same T-timestamp/MCP-version mismatch). | 🟡 deploy-hygiene / pre-M6 | reviewer 2026-07-07 (schema_migrations audit) | ✅ **CLOSED** at 670ad93 — all 22 files renamed to their 14-digit `schema_migrations.version` (1:1, same order, verified); pure renames (R100), doc refs updated, no stale T-refs. A `db push --dry-run` before deploy is the final confirmation. |
| ㉜ | **Dashboard UX (owner found testing M5; fix-prompt 0a9c77e).** 🅐 **stale-after-save (real bug — REVIEWER miss at 711ef1d + 983554a):** `RetailersQueue`/`ProductsPricing` freeze server data in `useState(initialX)` (no setter), so `router.refresh()` after a write re-renders with preserved state → the row stays stale until a full reload (DB write itself is fine, RLS-verified). 🅑 Deactivate/Reactivate/Edit show no spinner + `saving` clears before the refresh paints (use per-action spinner + `useTransition`/`isPending`). 🅒 no discoverable verify — add an explicit "Review & verify" primary on pending rows (no RLS change). 🅓 `tally_name` should fall back to `products.name` on read (don't copy into the column). | 🟡 was functional/UX | app M5 (711ef1d/983554a) — owner testing | ✅ **CLOSED** at f5c62eb — render-from-prop (🅐), `useTransition`/`busyKey` spinners (🅑), explicit "Review & verify" (🅒), `tally_name ?? name` (🅓); + `isPending` shadowing bug caught; tsc/eslint clean |
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
| ⑬ | Drift-protected `scripts/seed.ts` loader (seed-data.md's `--force-prices`/warn-on-drift re-run guard) deferred until the Node app is scaffolded. Re-seeding before it exists could clobber in-DB price edits. | 🟡 minor / deferred | M1.7 | 🟡 open — **rationale superseded-in-intent** by the catalog-admin in-app import (739ee8e): owner wants *intentional* overwrite, so the drift-protection this asked for is moot; the import may subsume the CLI loader entirely |
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

## Review of f4d071d — docs: correct D11 — products_admin_insert is a real (dormant) admin-only permission

**Verdict:** ✅ accept — a good correction (adds `products_admin_insert` per my f75937c note), decision still sound. But the new phrase "**exactly one** admin-only permission at the RLS layer" is *still* undercounting — a live query says **four**. Giving the complete verified list so D11 can be made exhaustive in one more pass — and owning that my own earlier note was itself incomplete.

**The complete admin-only RLS set (queried live just now — `admin` in the expr, no `accountant`/`salesman`):**
| policy | table · cmd | reachable in-app today? |
|---|---|---|
| `brands_admin_insert` | brands · INSERT | no — brands are seed-only (Phase-3 adds brand mgmt) |
| `brands_admin_update` | brands · UPDATE | no — same |
| `products_admin_insert` | products · INSERT | no — no add-product screen |
| `profiles_update_admin` | profiles · UPDATE | no — the role-change path, done in Studio (provisioning) |

So it's **four** admin-only policies, not one — and I under-caught too: my f75937c note named only `products_admin_insert` and missed both `brands_admin_*` (I hadn't queried `brands` then; I have now). **The decision is unaffected** — all four are unreachable from any screen today, so admin ≡ accountant *in-app* still holds exactly; only the enumeration needs to match reality.

**Suggested final wording:** "admin-only at the RLS layer: `brands_admin_insert`/`brands_admin_update`, `products_admin_insert`, `profiles_update_admin` — all dormant in-app today (brands = seed/Phase-3; products = no add-UI; profiles = role-change via Studio)." That makes D11 the exhaustive record it's trying to be, so none of the four is later rediscovered as a surprise. (Not filing a numbered flag — expecting the next commit to finalize it; I'll flag if it lingers.)

**Open flags:** none new — docs precision; decision sound. No 🔴 blocking; carried 🟡 ㉜ (fix before prod), ㉛ ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** still watching for the ㉜ dashboard-UX fix.

---

## Review of f5c62eb — fix(m5): dashboard-UX — stale-after-save, loading feedback, verify button, tally default (㉜)

**Verdict:** ✅ accept — all four ㉜ items fixed correctly (including 🅐, the real bug I missed), plus a genuine shadowing bug the builder caught mid-fix. `tsc --noEmit` + `eslint` clean. **㉜ CLOSED.**

**🅐 stale-after-save — fixed (the miss, resolved).** `ProductsPricing` and `RetailersQueue` drop the frozen `const [x] = useState(initialX)` and render straight from the prop (`{ initialProducts: products }` / `{ initialRetailers: retailers }`). Now `router.refresh()`'s fresh server props flow into the render — a save/verify/deactivate reflects without a reload. Canonical correct fix; `products`/`retailers` (and the derived groups/counts/filter) are recomputed each render from live props, no stale closure. ✓
**🅑 loading through the refresh — fixed** across all three screens. `useTransition` wraps `router.refresh()`; buttons drive `loading` off `isPending` (Products Save; OrderWorkbench Save/Mark-processed/Cancel) or a per-action `busyKey` (Retailers Deactivate/Reactivate — spinner on the clicked row, not a whole-list dim). Spinner holds from click until the refreshed data lands. ✓
**🅒 verify button — fixed.** Pending rows render an explicit primary **"Review & verify"** (opens the inline editor) beside Deactivate — discoverable, no RLS change. ✓
**🅓 tally default — fixed.** List shows `{sku} · {tally_name ?? name}`, editor `placeholder={p.name}`; `save()` still writes `tally_name || null` — **not** copied into the column, so "explicitly mapped vs defaulted" stays distinguishable for Phase-2. ✓
**Bonus (good builder catch):** the per-row business flag `isPending = !r.verified` **shadowed** `useTransition`'s `isPending` in the list-item scope — `loading={saving || isPending}` on Save & verify would've keyed off the business flag (always true for a pending row → stuck spinner). Renamed to `needsVerification`. Essential, correctly done. ✓

**Verified:** `tsc --noEmit` clean, `eslint` 0 on all three files. Write paths unchanged (only read/render + loading wiring), so the RLS/RPC behavior I proved live (incl. #6) still holds — and the UI now reflects it without a reload. No frozen `useState` reintroduced, no `tally_name` copy, no RLS touched (prompt's "Don't"s respected). Since 🅐 is a client-render fix I can't drive headless, this rests on the code (definitively the right pattern) + clean compile; the owner's own retest will confirm the pixels.

**Open flags:** ㉜ **CLOSED**. No 🔴 blocking. Carried: 🟡 ㉛ (sequence-grant hardening, deferred), ⑯ ⑬ ⑭ ⑦⑧⑨. (D11 enumeration finalization pending a builder pass — flagged at review(f4d071d).)

**Next:** review the D11 take-2 commit (aa5ac29), then M6.

---

## Review of aa5ac29 — docs: D11 take 2 — enumerate all 4 admin-only RLS policies

**Verdict:** ✅ accept — D11 is now complete and fully accurate; the four-policy table matches my live `pg_policies` query exactly, and I verified the supporting claims live too. Closes the D11-accuracy thread.

**Every claim verified live:**
- The four admin-only policies are exactly right: `profiles_update_admin`, `brands_admin_insert`, `brands_admin_update`, `products_admin_insert` — matches my query. ✓
- **`profiles_update_self` is salesman-only** (`id = auth.uid() AND auth_profile_role() = 'salesman'`) — so D11's "accountant has no UPDATE on profiles at all, not even its own row" is correct (I'd have guessed wrong from memory; confirmed by query). ✓
- **Accountant is SELECT-only on `brands`** (`brands_select_staff` = accountant/admin SELECT; no accountant INSERT/UPDATE) — correct. ✓
- The nuance that these are dormant because Studio runs as `postgres`/service-role (bypassing RLS), "not through these policies," is accurate. ✓

The decision (admin ≡ accountant *in-app*; oversight-only is convention) is unchanged and sound — all four are unreachable from any screen. The enumeration is now exhaustive, so none of the four gets rediscovered as a surprise later — D11's whole purpose. **D11-accuracy thread closed.**

**Open flags:** none new. No 🔴 blocking; carried 🟡 ㉛ (deferred), ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** M6 (deploy + pilot).

---

## Review of ec94d06 — data: backfill tally_name = name for all products (owner-requested)

**Verdict:** ✅ accept — owner-requested one-off backfill, applied live, migration-recorded, and it consciously + explicitly makes the 🅓 tradeoff. **Verified live: 42/42 products now have `tally_name = name`, 0 NULLs.** Separately, verifying this surfaced a migration-bookkeeping issue for M6 → new 🟡 ㉝ below.

**The backfill:** `20260707T150000_backfill_tally_name.sql` = `update products set tally_name = name where tally_name is null`. Live: total 42, `still_null` 0, `tally_name = name` for all 42 (the 1 pre-existing mapping also equalled its name). ✓
**On the 🅓 tension (which I flagged at f5c62eb):** this copies name→column, the opposite of 🅓's "keep NULL / don't copy." But it's an **owner call**, and the migration comment **explicitly documents the tradeoff** ("the 41 backfilled rows are no longer distinguishable from a row an accountant explicitly confirmed against the real Tally ledger"). The 🅓 *code* is unchanged — `save()` still stores exactly what's typed and never auto-copies on future edits (a row can still be cleared back to NULL). So it's a deliberate data decision, not an accidental contradiction; the read-fallback (`tally_name ?? name`) is now dormant but harmless. ✓
**Process note (my slip):** my first verify query errored "column tally_name does not exist" — that was a *malformed query* (I dropped the outer `FROM products`), not a schema problem; `products.tally_name` exists. Re-ran correctly. Flagging so it's not mistaken for a finding.

**🟡 ㉝ (new — for M6 deploy) — committed migration files don't match the applied `schema_migrations` versions.** The recent migrations were applied via MCP `apply_migration`, which recorded UTC-time versions (`20260707071615` update_order_items_reason · `…071620` realtime_orders · `…091019` backfill_tally_name), while the committed files use a non-standard **`T`-timestamp** format (`20260707T120000_…`/`…T120100_…`/`…T150000_…`) that corresponds to none of them (and isn't the CLI's 14-digit convention). Harmless at runtime — the SQL is applied and correct — but at **M6** a `supabase db push`/`migration up` from these files could mis-parse the `T` version, mis-order, or re-apply (e.g., re-running `realtime_orders`' `alter publication … add table orders` errors "already a member"). **Before prod:** dry-run `supabase db push` from the committed files onto a throwaway Supabase branch; if the `T` format/ordering misbehaves, rename to standard 14-digit timestamps and `supabase migration repair` the remote. (Pre-existing pattern since M1 — surfaced now because M6 is next; I can't test the CLI here, so this is a verify-before-deploy item, not an asserted break.)

**Open flags:** No 🔴 blocking. **New:** 🟡 ㉝ (migration file/version reconciliation — pre-M6). Carried: 🟡 ㉛ (deferred), ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** M6 (deploy + pilot) — ㉝ belongs on its checklist.

---

## Review of 20400cd — docs(phase3): add per-brand pricing mode (LG manual) + admin approval gate

**Verdict:** ✅ accept — an accurate, internally-consistent, honest Phase-3 capture (not built). Its load-bearing factual claim checks out live, and it's careful about the two things that matter: relaxing the price-trust boundary and extending the state machine.

**Verified:**
- **The key claim is correct:** live `orders_status_check` = `status IN ('submitted','processed','cancelled')` (queried). So the doc is right that `pending_approval` is **a real CHECK-extending migration, not the "status headroom" PLAN Phase 5 implied** — good that it corrects that rather than inheriting the wrong assumption. ✓
- **`fixed` mode = today's behavior** (RPC snapshots from catalog, client price ignored) — matches what I verified in `submit_order`. ✓

**Design is sound + honest:**
- **`manual` mode deliberately relaxes the "client never sends a price" invariant — but only for manual brands**, with `>0` sanity ceiling, snapshot into `order_items.unit_price_paise`, and actor audit in `order_events`; Zebronics keeps its untamperable guarantee. Explicitly a scoped trust-boundary change (`brands.pricing_mode fixed|manual`), not blanket — the right framing for the money path. ✓
- Correctly **amends the earlier "what does NOT change"** — the brand/ref change is additive, but manual mode *does* touch the RPC price source + adds a state. No leftover over-broad claim. ✓
- **Admin-only approval is consistent with D11:** D11 recorded admin ≡ accountant *today* and flagged "if a real enforced split is ever wanted, that's a future product decision" — this LG approval gate is precisely that first split (owner specified admin, not accountant). Forward-consistent, not contradictory. ✓
- Correctly distinguishes LG-manual (free entry + approval, no floor/tiers) from Phase-5 tiered-discounts (list price + tiers, no free-typing) — different mechanisms that can coexist. ✓
- Leaves the right things **open** (reject → back-to-salesman vs cancelled; whether the 2h window applies pre-approval; exact event names) instead of over-specifying an unbuilt feature. ✓

**Open flags:** none new — not-built design note; the manual-pricing relaxation + `pending_approval` state + admin approval are Phase-3-time work (owner: worry-later). No 🔴 blocking; carried 🟡 ㉝ (pre-M6), ㉛, ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** M6 (deploy + pilot).

---

## Review of fbd360e — docs: builder fix-prompt for salesman new-order flow (density, in-cart color, category headers, drop step labels)

**Verdict:** ✅ accept — accurate fix-prompt; every code reference verifies against the actual files, the fixes are sound, and it guards the one thing that matters (tap targets). Pure UX polish from owner real-use feedback, no correctness issue — no ledger flag; I'll verify the fix commits when they land.

**Code references verified:**
- `.productRow` padding really is `10px 0` (QuickOrder.module.css:70) — "too tall" + reduce-padding is accurate. ✓
- `.productRowActive` really is `#eff6ff` with a 2px accent left-bar (:75) — "too pale" is right; the stronger tint (`#dbeafe`+) keeps the bar. ✓
- `.categoryHeader` (:47) is the section-label style; grey→`--color-ink`, 10→12px, sticky is a sound scannability fix. ✓
- `FlowHeader.subtitle` is currently **required** (`subtitle: string`, :5) — so "make it optional" is the correct enabler; the component comment even reads "back arrow + title + STEP n/3." ✓
- Current subtitles match exactly: PickRetailer `"NEW ORDER · STEP 1 / 3"` (×2), Review `"NEW ORDER · STEP 3 / 3"`, QuickOrder `"<AREA> · NEW ORDER"`. The S3="Select retailer" / S4=shop+area / S5="Review order" rework drops the step language cleanly. ✓

**Good judgment in the prompt:**
- Overarching rule — **never shrink real tap targets; keep ≥48px via invisible hit-area padding** as the visible cell shrinks — matches the design-spec constraint I verified at M4. Right guard for a density change. ✓
- The **sticky-header caveat is real and correctly flagged:** the search bar's height varies because the `resultMeta` ("N of 34") line only renders while searching (exactly the conditional in QuickOrder.tsx) — so pin a consistent offset + verify the two stickies don't overlap/gap. ✓
- Requires updating **design-spec §3** (the STEP-subtitle spec) in the same commit — changelog discipline. ✓

**Open flags:** none new — UX-polish prompt, no correctness/spec defect (unlike the dashboard-UX prompt, which had the real 🅐 bug). No 🔴 blocking; carried 🟡 ㉝ (pre-M6), ㉛, ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** the fix commits (on the owner's new branch) — I'll verify density/tap-targets/sticky + the header changes when they land.

---

## Review of 739ee8e — docs: catalog-admin design — manual add + CSV/Excel import (admin-only)

**Verdict:** ✅ accept — a well-reasoned, accurate, forward-consistent design capture (not built). Its recommended upsert key is feasible against live data (verified), and it ties several threads together cleanly.

**Verified + consistent:**
- **Accurate premise:** the Products tab can price/edit but can't **add** products today — correct (no add path; exactly why `products_admin_insert` has been dormant). This design is what puts that admin-only policy to use. ✓
- **Admin RLS covers it, no service-role:** admin INSERTs via `products_admin_insert`, UPDATEs via `products_staff_update` — matches the D11 enumeration I just finalized ("accountant has UPDATE not INSERT; admin has both"). "Admin-only, revisit for accountant" is spot-on. *(Minor: it says admin has "`ALL` on products" — precisely it's INSERT+UPDATE+SELECT, no DELETE, which is fine under deactivate-not-delete.)* ✓
- **The recommended upsert key `(brand_id, tally_name)` is immediately feasible** — queried live: all **42/42** products have a unique `(brand_id, tally_name)` (and unique name), **0 dup keys**. So dropping `sku` and adding `unique(brand_id, tally_name)` applies cleanly to today's data — no dedup needed. ✓
- **Recontextualizes ec94d06:** the `tally_name = name` backfill I reviewed earlier is the **groundwork** for making `tally_name` NOT-NULL + the upsert key ("blank ⇒ display name" + backfill = always populated). The two commits now read as one plan. ✓
- **Import design is sound:** brand-scoped (one brand/file), upsert-not-duplicate, never-deletes (reports absent rows — same safety as the seed), **transactional dry-run preview** (all-or-nothing so a bad file can't half-corrupt the catalog), admin Server Action, downloadable template, `.xlsx` via server-side parser. ✓

**Threads it touches (flagged correctly):**
- **Bears on ⑬:** the doc notes this in-app import could **subsume** the deferred CLI seed loader, and the owner **wants intentional overwrite** ("overwrite any items") — which directly addresses ⑬'s original worry (a re-seed clobbering in-DB price edits). So ⑬'s drift-protection ask is **superseded in intent**; I've annotated ⑬ in the ledger accordingly (left open — nothing built).
- **Revises seed-data.md** ("tally_name empty until Phase 2") and the seed script's `sku`-based upsert + `sku ~ '^ZEB-'` check — correctly flagged as build-time changes; ties to Phase-3 `pricing_mode` (hide Price for `manual` brands). ✓
- Leaves the real decisions **open** (upsert key, drop sku, categories-table-vs-dropdown, dry-run, Excel-now-vs-later) — appropriate for an unbuilt feature. ✓

**Open flags:** none new — not-built design note; ⑬ annotated (superseded-in-intent). No 🔴 blocking; carried 🟡 ㉝ (pre-M6), ㉛, ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** M6 / the salesman-new-order UX fixes, whichever lands.

---

## Review of 4e4f215 — fix(salesman): new-order flow density, in-cart color, sticky category headers, drop STEP labels

**Verdict:** ✅ accept — all four fbd360e items correctly implemented; tap targets preserved, and I independently verified the sticky-offset arithmetic (the one thing the builder flagged as needing a device). `tsc` + `eslint` clean. On branch `ui/salesman-dashboard`.

**Verified:**
- **① Density:** `.productRow` `10px 0`→`6px 0`, `.categoryHeader` `12px 0 6px`→`8px 0 4px`. **Tap targets intact** — `Stepper.module.css` hard-sets the buttons to `min-width/min-height: 48px` (both controls), so the row can't render shorter than 48px regardless of padding; density and hit-area are decoupled exactly as the commit claims. ✓
- **② In-cart color:** `#eff6ff`→`#dbeafe` (clearly more saturated); 2px accent left-bar kept. ✓
- **③ Sticky category headers — correct, and I checked the math:** grey→`--color-ink`, size→12px, `position:sticky; top:var(--search-bar-height); z-index:9`. The header sits flush below the **already-sticky** search bar (`.searchBar` = `position:sticky; top:0; z-index:10` — header z:9 < bar z:10, so it tucks under). The variable-height caveat the prompt raised is fixed properly: the result-count line is now **always rendered** (a non-breaking space when idle) with `line-height:14px`, so the bar height is constant. And `--search-bar-height: 83px` is **exactly right** — summing the actual CSS: `20px` vertical padding + `44px` input + `4px` gap + `14px` result line + `1px` border = **83px**. No gap/overlap between the two stickies, to the pixel. ✓
- **④ STEP labels dropped:** `FlowHeader.subtitle` now optional (`subtitle?`, conditional render); S3 "Select retailer"/"Add new shop" + S5 "Review order" show a bare title; S4 shows **retailer name + area** (`subtitle={retailerArea ?? undefined}`). Back arrow kept everywhere. `design/phase1-design-spec.md §3` updated same-commit (changelog discipline). ✓

**On what couldn't be verified headless:** the builder was refreshingly explicit — actual color saturation, real row density, and sticky stacking "want real-device confirmation given this exact codebase's prior sticky bug (M4 bottom-bar)." Right call. I independently confirmed the **sticky arithmetic** (83px = the bar's real height; bar is sticky at top:0) — the exact failure mode that bit at M4 — so the structural risk is low; what's left is pure visual polish a phone will settle.

**Open flags:** none new. No 🔴 blocking; carried 🟡 ㉝ (pre-M6), ㉛, ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** more new-order UX commits on `ui/salesman-dashboard`, or M6.

---

## Review of dd4b0fb — docs: lock catalog-admin decisions + add Claude Design brief for Products add/import

**Verdict:** ✅ accept — the locked decisions match the design note + the feasibility I verified, and the design brief is faithful to the app's actual design tokens and grammar. Docs-only, forward-consistent.

**Locked decisions (catalog-admin-design.md):**
- Upsert key `(brand_id, tally_name)` + drop `sku` + `tally_name` NOT NULL default=display name + `unique(brand_id, tally_name)` — exactly the recommendation, and I verified live it's feasible (**42/42 unique, 0 dup keys**). ✓
- Category = simple text + dropdown + add-new (no `categories` table); import dry-run built; Excel-primary via SheetJS (parses CSV too). All matching the design note, now owner-confirmed; the SheetJS impl notes (first sheet, trim blanks, coerce the Price cell, cap file size) are sound. ✓

**Claude Design brief (products-admin-design-prompt.md) — palette verified against tokens:**
- Every hex matches `globals.css` exactly: accent `#1d4ed8` = `--color-accent`, ink `#14181f` = `--color-ink`, paper `#f2f3f5` = `--color-paper`, hairline `#d8dbdf` = `--color-hairline`, amber `#b45309` = `--color-amber`. Mockups will match the built app, not drift. ✓
- The **"amber = pending only — avoid it in the import preview"** guard matches globals.css's own comment ("amber = pending, never red") — a real cross-app consistency catch (New=accent, Updated=ink/grey, Error=red). ✓
- Grammar (hairlines, 2px corners, mono figures, flat tags w/ leading square, one filled-accent action, phone = full-screen sheet with the table scrolling in its own container, never the page body) matches the S8/S9 instrument language. ✓
- Content is real (Zebronics + LG, real product names, ₹ en-IN, some TBD) and forward-consistent — the LG "prices entered per order" note aligns with the Phase-3 `manual` pricing decision (20400cd); blank price = "hidden from salesmen" aligns with D2. ✓

**Open flags:** none new — design-input docs; the feature (the `tally_name` NOT NULL + drop-`sku` migration, the add/import UI) is build-time work. No 🔴 blocking; carried 🟡 ㉝ (pre-M6), ㉛, ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** M6 / whatever lands on `ui/salesman-dashboard`.

---

## Review of cae157e — fix(salesman): on-device polish — search gap, back-button centering, navy sticky headers, full-bleed strip

**Verdict:** ✅ accept — four correct on-device fixes; the search-gap one is a genuine *improvement* over 4e4f215's fixed offset. `tsc` + `eslint` clean.

- **① Search gap → ResizeObserver (supersedes my 83px verification):** 4e4f215 held the sticky offset constant by always rendering the result line (blank when idle) — which I verified was arithmetically exact (83px) but couldn't see cost ~18px of dead space on device. This reverts to rendering the line only while searching and instead **measures the bar's real height with a `ResizeObserver`, writing `--search-bar-height` via a plain DOM style mutation (no state/re-render)** — so the sticky category offset tracks the true height in both states with no blank line. Better on both counts: no dead space *and* no hardcoded px to drift. `64px` is now just the SSR/no-JS fallback (20 padding + 44 input, idle). Implementation is correct (refs on `.page`/`.searchBar`, sync on mount + resize, disconnect on cleanup, reads `offsetHeight` fresh). ✓
- **② Back-arrow centering:** `.back` `margin:-12px` (all sides) → `margin:0 0 0 -12px` + `flex-shrink:0`. The vertical negatives were shrinking the margin box and knocking the glyph off the title's vertical center; horizontal-only tuck lets `align-items:center` do it. Correct diagnosis + fix (still a 48px tap target, tucked left). ✓
- **③ Navy category headers:** `--color-ink` (#14181F, near-black) → `--color-accent` (#1D4ED8). Owner device-call (ink read as black), recorded in spec §3. Mild note: accent is otherwise "the one primary action per screen" — but category headers are non-interactive labels, so it's a color choice, not an action-signal conflict. Acceptable. ✓
- **④ Full-bleed strip:** `.categoryHeader` gains `margin: 8px -16px 0` + `padding: 8px 16px 4px` — the −16px pulls the white band + hairline to the screen edges (out of `.list`'s 16px padding) while the compensating padding keeps the label at the content inset, so rows scrolling under the sticky header can't peek through a side gutter. Correct full-bleed technique; contained within `.list` (no page overflow). ✓

**Spec:** design-spec §3 S4 updated to match (accent-navy, full-bleed, live-measured offset) — changelog discipline. Builder again explicit that pixel-level look wants a real device (no browser here); the structural logic (ResizeObserver, margin math) is sound and I confirmed it compiles/lints.

**Open flags:** none new. No 🔴 blocking; carried 🟡 ㉝ (pre-M6), ㉛, ⑯ ⑬ ⑭ ⑦⑧⑨.

**Next:** more `ui/salesman-dashboard` polish, or M6.

---

## Review of 3b4f861 — feat(dashboard): shared FilterDropdown shell + controlled DateRangeFilter (S8 revamp commit 1)

**Verdict:** ✅ accept — clean promotion of the `/date-demo` spike into two reusable, correctly-controlled components. Frontend-only as promised; build + tsc + eslint all clean. No new flags.

**Phase / commit goal (as I understood it):** First of 4 commits in the S8 orders-revamp (prompt `orders-revamp-builder-prompt.md`). Extract the spike's pure date helpers into `src/lib/date-range.ts`; build the shared `FilterDropdown` shell that both DATE and (commit 4's) SALESMAN boxes will use so they're pixel-identical; build the controlled `DateRangeFilter` on top of it holding **no range state**; keep `/date-demo` alive as a thin local-state wrapper until commit 4 deletes it. **No DB/RPC/migration** — verified: the commit touches only `src/lib/` + `src/app/dashboard/` + `src/app/date-demo/`, zero `supabase/` files.

**What works (verified by execution):**
- **`npm run build` clean** — `✓ Compiled successfully in 1939ms`, TypeScript passed, 12/12 static pages generated. `/date-demo` still in the route list (`○ /date-demo`, prerendered) → the "stays testable until commit 4" claim holds. **`tsc --noEmit` exit 0; `eslint` on all four files exit 0** — the commit message's verification claims reproduce exactly.
- **`DateRangeFilter` holds no range state** ([DateRangeFilter.tsx:23-28](src/app/dashboard/DateRangeFilter.tsx#L23-L28)) — the only `useState` is `tick`(=`nowMs()`)→`today`, which is *today's date for `defaultMonth`*, not the selected range. Selection flows entirely through `value`/`onChange` props. Acceptance criterion met literally.
- **The `nowMs()` purity dodge is correct** — `useState(nowMs)` + `new Date(tick)` keeps `new Date()` out of the render body (react-hooks/purity), matching the stated OrderWorkbench pattern. Same discipline in `DEFAULT_RANGE` being a *function* (lazy `useState` initializer) not a module-eval constant — so "now" is captured on mount, not at import. Both are the right call and eslint agrees (clean).
- **Fixed-width, non-shifting trigger** ([FilterDropdown.module.css:32-40](src/app/dashboard/FilterDropdown.module.css#L32)) — `.trigger` gets an explicit `width` (280 default) and `.triggerValue` has `min-width:0; overflow:hidden; text-overflow:ellipsis`, so a long `rangeLabel` ("8 Jul 2026 — 7 Aug 2026") ellipsizes *inside* the box rather than stretching it. The box's size/position is locked regardless of value length — the prompt's core "locked box" requirement.
- **Controlled/uncontrolled duality is real and used correctly** — `FilterDropdown` derives `open` from `openProp ?? internalOpen` and `setOpen` fans out to both `onOpenChange` and internal state ([FilterDropdown.tsx:34-40](src/app/dashboard/FilterDropdown.tsx#L34)). `DateRangeFilter` passes neither → uncontrolled → stays open across preset/day picks (right: the user may still be dragging a range). Commit 4's SalesmanFilter will pass both to close-on-pick. The seam is built as designed.
- **Dismiss on outside-click + Esc** ([FilterDropdown.tsx:76-91](src/app/dashboard/FilterDropdown.tsx#L76)) — `mousedown` outside `wrapRef` and `Escape` both call `setOpen(false)`; listeners registered only while `open`, cleaned up on close/unmount. Correct.
- **Mobile popover positioning** ([FilterDropdown.tsx:55-74](src/app/dashboard/FilterDropdown.tsx#L55)) — `useLayoutEffect` measures the trigger and pins the popover `position:fixed; left/right:12px; width:auto` on `<768px` (where the filter row wraps and a CSS-only anchor could shoot off-edge); desktop stays pure-CSS `position:absolute` below-left. `useLayoutEffect` (not `useEffect`) avoids a stale-position paint flash on first open. Sound reasoning, and it's guarded by `open` so the closed-state style is never read.
- **Spike theming carried verbatim** — 2px square day cells (`--rdp-day_button-border-radius: var(--radius)`), mono day numbers (`--font-figures`), accent range, and the `.rdp-selected { font-size: inherit }` override that kills react-day-picker's size-jump on selected digits ([DateRangeFilter.module.css:53-75](src/app/dashboard/DateRangeFilter.module.css#L53)). The `:global(.rdp-root)` selector out-specifies the library's own `--rdp-*` block, so theming wins regardless of stylesheet order — a real correctness point, not just style.
- **`/date-demo` deletion is clean** — the rewritten `DateRangeDemo.tsx` imports no `.module.css`, so deleting `DateRangeDemo.module.css` (−154 lines) leaves no dangling import (build confirms). The demo is now a 14-line wrapper; the actual picker logic lives in the promoted component it exercises.
- **Preset active-highlight logic** — `sameRange(value, p.range())` keys each side to `startOfDay`-normalized `from-to` millis (or `"all"` for undefined), so the day-granular comparison is stable within a session and "All" correctly matches `undefined` on both sides ([date-range.ts:48-52](src/lib/date-range.ts#L48)). Default (Last 30 days) lights the right preset.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Popover overflow at 375px is CSS-reasoned, not browser-rendered** — I have no headless browser in this session, so I verified the no-overflow claim by reading the mobile media query (`@media (max-width:767px)`: panel `width:100%`, column stack, presets wrap horizontally) + arithmetic: the calendar is `--rdp-day-width:40px × 7 + 12px×2 padding ≈ 304px`, and the fixed popover spans `375 − 24 = 351px`, so it fits at the 375px acceptance bar. It gets tight below ~330px (calendar 304 vs e.g. 320−24=296 → ~8px clip), outside the stated target but worth an eye when commit 2 lands it in the real ledger row. Confirm live at 375px on device.
- **react-day-picker range-mode deselect → `undefined`** — clicking the current single `from` day again deselects it, and `onSelect(undefined)` flows straight to `onChange`, flipping the filter to "All dates". Inherited spike behavior, arguably expected, but once this drives the ledger (commit 2) a stray second-click reading as "show everything" is a mild surprise; note it for the commit-2 UX pass, no change needed here.

**Domain / correctness checks:** Money math / RLS / state-machine / snapshots — **N/A**, this commit is pure presentational frontend with no data-layer touch (confirmed by the diff scope). Standing checklist items don't apply until commit 2 wires the predicate into `OrdersList`; I'll exercise the IST `istDateKey` range filter and the live/Realtime tab counts against the actual ledger then.

**What I tried:** `git show 3b4f861 --stat` (scope = 7 files, all frontend); read all four new files + the rewritten demo; `grep nowMs src/lib/cart.ts` (export exists, line 74); `npx tsc --noEmit` → exit 0; `npx eslint <the 4 files>` → exit 0; `npm run build` → compiled clean, TS passed, `/date-demo` present in route table. CSS/positioning verified by source reading + arithmetic (no browser this session).

**Open flags (cumulative):** none new. No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 2 (wire the range predicate into `OrdersList` with `DEFAULT_RANGE`, default Last 30 days, IST `istDateKey` inclusive compare, `{n} orders · {rangeLabel}` header, tabs-left/filters-right row) — where I'll first get to verify the *filter behavior* by execution against the live ledger rather than just the component shell.

---

## Review of c76c120 — feat(dashboard): wire DateRangeFilter into the ledger, default last 30 days (S8 revamp commit 2)

**Verdict:** ✅ accept — the range predicate is correct (inclusive both ends, chronologically-sound string compare), the old date `<select>` is cleanly excised with no dangling refs, and the filter-row layout is set up for commit 3's folder tabs. Build/tsc/eslint clean.

**Phase / commit goal (as I understood it):** Commit 2 of the S8 revamp — replace the old all/today/yesterday date `<select>` with the promoted `DateRangeFilter`, defaulting to **Last 30 days**; filter orders by IST day inclusive of `[from, to]`; show `{n} orders · {rangeLabel}` in the header; and regroup the row as tabs-left / (salesman + date + search)-right, flush on the table's top rule so commit 3's folder-tab can connect. Still frontend-only (2 files: `OrdersList.tsx` + its CSS).

**What works (verified by execution):**
- **The IST range predicate is correct** ([OrdersList.tsx:104-111](src/app/dashboard/OrdersList.tsx#L104)). `range?.from` falsy ⇒ "All" (no date exclusion); else `key = istDateKey(new Date(o.submitted_at))` is excluded when `key < fromKey || key > toKey`, with `toKey = istDateKey(range.to ?? range.from)` handling the single-day (to-still-undefined) case. I node-tested the string compare across 6 boundary cases — **inclusive on both `from` and `to`, single-day range matches its one day, day-before/day-after excluded, all PASS.**
- **`istDateKey` makes the compare sound** — it's `Intl.DateTimeFormat("en-CA", { timeZone: IST_TIME_ZONE, month:"2-digit", day:"2-digit" })` → zero-padded `YYYY-MM-DD`, so lexicographic `<`/`>` **is** chronological order. The `submitted_at` side is converted to the IST calendar day regardless of browser TZ (it passes an explicit `timeZone`), so the DB's UTC timestamps bucket into the right IST day. Reuses the exact format already trusted elsewhere in `format.ts`.
- **"assumes an IST browser" caveat is accurate and is *not* a regression** — the only TZ-sensitivity is that `range.from`/`range.to` come from react-day-picker at *local-browser* midnight, so a non-IST browser could shift the picked boundary by a day. But the prior today/yesterday logic had the identical exposure (`istDateKey(new Date(tick))` off a local instant), and the deployment target is IST. In an IST browser the boundary is exactly the picked day. Same assumption as before, honestly documented.
- **Old date filter fully excised** — `type DateFilter`, the `dateFilter` state, `todayKey`/`yesterdayKey`, and the `<select>` are all gone; `grep` across `src/` finds **no dangling reference** (the two `todayKey` hits are an unrelated local inside `format.ts`). `tsc --noEmit` exit 0 confirms no broken symbol.
- **Header label** ([OrdersList.tsx:152](src/app/dashboard/OrdersList.tsx#L152)) — now `{n} order(s) · {rangeLabel(range)}`, singular/plural preserved, e.g. default → `N orders · 8 Jun 2026 — 7 Jul 2026`.
- **Default = Last 30 days** via `useState<DateRange|undefined>(DEFAULT_RANGE)` (lazy initializer — `DEFAULT_RANGE` is the function from commit 1, so "now" is captured on mount). The four real test orders (order_no 1001–1004, submitted during owner testing on/around 2026-07-07) fall inside 30 days, so they still show by default; **All** preset restores full history.
- **Filter-row layout** — `.filters` gains `justify-content: space-between`; salesman + date + search now wrapped in `.filterGroup` (right cluster), tabs stay left. The `-12px` bottom margin that pulls the row flush onto the table's top rule is correctly **scoped to the `≥768px` media query** (desktop table view) — the mobile card list has no top rule, so it keeps the normal gap. Sound reasoning; sets up commit 3's folder tab.
- **Bounded-fetch seam documented, not built** ([OrdersList.tsx:97-100](src/app/dashboard/OrdersList.tsx#L97)) — a one-line comment marks where a server-side range query would swap in when volume outgrows the client-side fetch, exactly as the guardrail asked ("mark the seam, don't build it").
- **`npm run build` clean** (full route table, no errors), **`tsc --noEmit` exit 0**, **`eslint OrdersList.tsx` clean**.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **`rangeLabel` format vs the mock** — the header/mock example was `8 Jun – 7 Jul 2026` (shared year, en-dash), but `rangeLabel` renders `8 Jun 2026 — 7 Jul 2026` (year on both sides, em-dash). Purely cosmetic and the prompt said "e.g.", so no change required — just flagging that the shipped label is more verbose than the mock if the owner wants the compact shared-year form later.
- **Default-30-days hides older orders** — a deliberate behavior change from the old "All" default; anything >30 days old is now hidden until the user picks **All** or a wider range. Intended per the prompt; noting it so it's a known, not a surprise, when the owner opens S8.
- **Two independent "today" clocks now** — `DateRangeFilter` has its own `useState(nowMs)` and `OrdersList` has another; a session open across local midnight could drift the picker's `defaultMonth`/preset boundaries vs the list's. Negligible for a field tool (nobody holds S8 open across midnight), and both are day-granular. No action.

**Domain / correctness checks:** Money math / RLS / state-machine / snapshots — **N/A** (no data-layer change; `ORDERS_SELECT` untouched, still carries `order_items(count)` which commit 4 removes). The one correctness surface here — the date bucketing — is verified above (IST day key + inclusive string compare). Realtime insert/update path is unchanged by this commit; I'll re-exercise live tab counts under commit 3 where the count refactor lands.

**What I tried:** `git show c76c120` (full diff, 2 files, frontend-only); read `istDateKey` in `src/lib/format.ts` (en-CA IST `YYYY-MM-DD`); `grep -rn dateFilter\|DateFilter\|todayKey\|yesterdayKey src/` (no dangling OrdersList refs); node harness on the `key<from||key>to` predicate across 6 boundary cases + single-day (all PASS, inclusive); `npx tsc --noEmit` (0); `npx eslint OrdersList.tsx` (clean); `npm run build` (clean). Row layout/`-12px` flush verified by CSS reading (no browser this session).

**Open flags (cumulative):** none new. No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 3 (two-stage filtering — `scoped` = salesman+range+search, `finalFiltered` = + status tab; per-tab counts from `scoped` with `submitted+processed+cancelled===all`; folder-tab active state) — where I'll verify the counts stay consistent across tab switches and under a live Realtime insert.

---

## Review of 659359b — feat(dashboard): live per-tab counts + folder-tab strip (S8 revamp commit 3)

**Verdict:** ✅ accept — the two-stage split is correct, and the `submitted+processed+cancelled===all` invariant it relies on is **structurally guaranteed** (verified live: the DB CHECK + NOT NULL). Build/tsc/eslint clean.

**Phase / commit goal (as I understood it):** Commit 3 — refactor filtering into `scoped` (salesman+range+search, no status) to drive live per-tab counts, and `finalFiltered` (scoped narrowed by the active tab) for the table/keyboard-nav; render each tab as `Label + muted count`; replace the accent-box active state with a white hairline "folder tab" whose bottom edge overlaps the table's new 2px top rule so it reads as physically connected. Frontend-only (2 files).

**What works (verified):**
- **Counts are stable across tab switches — by construction** ([OrdersList.tsx:106-128](src/app/dashboard/OrdersList.tsx#L106)). `scoped` filters on salesman + range + search only; `tabCounts` (`all`/`submitted`/`processed`/`cancelled`) all derive from `scoped`, which has **no dependency on `status`**. Switching tabs mutates only `status`, which changes `finalFiltered` but leaves `scoped`/`tabCounts` untouched — so the numbers can't flicker as you click between tabs. Correct.
- **`submitted + processed + cancelled === all` is a real invariant, not luck — verified LIVE.** The claim rests on `orders.status` being exactly 3 values; I checked the catalog, not the commit message: `orders_status_check` = `CHECK (status = ANY (ARRAY['submitted','processed','cancelled']))` **and** `status` is `NOT NULL` (live distinct today: `{submitted, cancelled}`). So every `scoped` row lands in exactly one of the three named buckets — no null row, no fourth value — and the three sub-counts partition `all` exactly. The commit's "holds structurally, not just by construction" is accurate.
- **Live update path intact** — `scoped`/`tabCounts`/`finalFiltered` are plain derived values recomputed in the render body (no `useMemo` freezing them), off the same `orders` state that the existing Realtime subscription patches on INSERT/UPDATE. A new order arriving bumps `orders` → re-render → counts recompute. Verified by reading the data flow (Realtime enablement on `orders` was confirmed live in a prior review, ㉘).
- **`finalFiltered` still feeds keyboard-nav correctly** — `status === "all" ? scoped : scoped.filter(...)`; the downstream `selectedIndex` clamp is unchanged, so Arrow/Enter still operate on exactly what's rendered.
- **Folder-tab CSS matches the spec** ([OrdersList.module.css:59-95](src/app/dashboard/OrdersList.module.css#L59)) — inactive `.filterTab` now `background:none; border:none` (plain text, ink label); `.filterTabActive` is the only boxed one: white bg, `1px hairline` top/left/right, `border-bottom:none`, top-only radius, `margin-bottom:-1px` + `z-index:1` to overlap the table's new `border-top: 2px solid --color-ink` by ~1px. Outline (not color) is the active signal, label stays ink both states — exactly the prompt's "folder tab connected to the ledger." Count rendered in muted mono (`.tabCount`, `--color-locked`, `--font-figures`).
- **`npm run build`** → `✓ Compiled successfully`; **`tsc --noEmit`** exit 0; **`eslint OrdersList.tsx`** clean.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Latent coupling for the deferred Phase-3 statuses.** The `sum===all` guarantee holds *only while the CHECK enumerates exactly the tabbed statuses*. The prompt itself says Phase-3 will add `pending_approval`/`approved` and asks to keep the tab list data-driven — the day someone widens `orders_status_check` **without** adding a matching tab, `all` will silently exceed `submitted+processed+cancelled` (the new-status rows count in `all` but no tab shows them). Not a bug today (verified 3-value CHECK), but when the tab list is made data-driven, derive it from the status enum so the two can't drift. Worth a one-line note in `docs/specs/order-lifecycle.md`.
- **Cosmetic double-gap in the tab label** — the JSX keeps a literal `{" "}` between label and count, and `.filterTab` is now `display:flex; gap:4px`, so there's both a space glyph and the flex gap (`All  7`). Harmless, trivially removable — drop the `{" "}` now that the gap spaces them.

**Domain / correctness checks:** Order state machine — the tab set (`submitted/processed/cancelled`) is verified to match the live status domain exactly (CHECK above); no state introduced or bypassed. Money/RLS/snapshots — N/A (presentational; no data-layer change, `ORDERS_SELECT` unchanged). Mobile — folder-tab connect is desktop-table-only (the `-12px` flush + top rule live under `≥768px`); mobile cards keep plain tabs, consistent with commit 2.

**What I tried:** `git show 659359b` (full diff, 2 files); live `pg_get_constraintdef` on `orders` CHECK constraints + `information_schema` nullability + `array_agg(distinct status)` (→ `orders_status_check` enumerates the 3 values, `status NOT NULL`, live `{submitted,cancelled}`); traced `scoped`→`tabCounts`→`finalFiltered` data flow for tab-switch stability + Realtime recompute; `npx tsc --noEmit` (0); `npx eslint OrdersList.tsx` (clean); `npm run build` (compiled successfully). Folder-tab pixel overlap verified by CSS reading (no browser this session).

**Open flags (cumulative):** none new. No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 4 (SalesmanFilter on the shared `FilterDropdown` — the controlled/close-on-pick path; drop LINES incl. `order_items(count)` from `ORDERS_SELECT` **and** `page.tsx`'s fetch; delete `/date-demo`) — I'll verify the two filter boxes are truly identical, that `/date-demo` 404s, and that no `order_items(count)` join survives anywhere.

---

## Review of 90dc13f — feat(dashboard): matching SalesmanFilter dropdown, drop LINES, remove /date-demo spike (S8 revamp commit 4)

**Verdict:** ✅ accept — completes the S8 revamp (4/4). SalesmanFilter matches DATE on the shared shell, LINES is removed **everywhere** (I grep-verified — no orphan), the legit line-item fetches are untouched, and `/date-demo` is gone from the route list. Build/tsc/eslint clean.

**Phase / commit goal (as I understood it):** The last S8 commit — replace the native salesman `<select>` with a `SalesmanFilter` built on the shared `FilterDropdown` (so it's pixel-identical to DATE) that closes on pick; strip the LINES column and its `order_items(count)` join from every consumer (table, mobile card, both selects, the `DashboardOrderRow` interface); delete the now-absorbed `/date-demo` spike.

**What works (verified by execution):**
- **SalesmanFilter is the shared shell, close-on-pick** ([SalesmanFilter.tsx](src/app/dashboard/SalesmanFilter.tsx)) — uses `FilterDropdown` **controlled** (`open`/`onOpenChange`), and `select(id)` calls `onChange(id)` then `setOpen(false)`, so a pick closes it (vs DateRangeFilter's uncontrolled stay-open). Both boxes pass no `width` → default 280px, same trigger CSS (mono caption / bold ellipsized value / chevron) → **visually identical**, exactly the prompt's requirement. `valueLabel` = selected `full_name` or `All salesmen`; active option marked via `optionActive`. Controlled outside-click/Esc still close it (FilterDropdown routes both through `onOpenChange`).
- **LINES fully removed — grep-verified, no orphan** — `<th>LINES</th>`, its `<td>`, the mobile card `· N lines`, `order_items(count)` from **both** `ORDERS_SELECT` (OrdersList) **and** `page.tsx`'s initial fetch, and the `order_items: {count}[]` field on `DashboardOrderRow` are all gone. `grep -rn order_items src/app/dashboard/` returns **zero** hits in `OrdersList.tsx`/`page.tsx` (remaining hits are the legit detail/pick-slip line fetches + one code comment). `tsc --noEmit` exit 0 confirms no dangling `order.order_items` reference survives.
- **Column counts stay balanced** — header now 6 (`REF · SUBMITTED · SALESMAN · RETAILER · TOTAL · STATUS`), body 6 `<td>` (ref, timestamp, salesman, retailer, total, status). No off-by-one misalignment from the removed cell. The `839aff5` weight/color hierarchy (SUBMITTED/SALESMAN muted via `cellMeta`, RETAILER bold via `cellRetailer`) is intact — untouched by this diff.
- **Legit `order_items` uses untouched** — `dashboard/orders/[id]/page.tsx` (full line rows), `dashboard/orders/[id]/pick-slip/page.tsx`, and `orders/[id]/page.tsx` all still fetch real line-item data (product_name/qty/price/position), not a count. Correctly distinguished from the dropped count-join and left alone.
- **Realtime UPDATE refetch rationale kept honest** ([OrdersList.tsx:66-70](src/app/dashboard/OrdersList.tsx#L66)) — the comment explaining *why* an UPDATE refetches the joined row (rather than patching the raw payload) previously cited `order_items(count)`; with that gone, it's correctly re-pointed to `retailers(name, verified)` — still a joined field absent from the raw `postgres_changes` payload, so the refetch (flag ㉚.3's fix) is **still justified and still present**. Good: the builder updated the reason instead of silently leaving a now-false comment or dropping a still-needed refetch.
- **`/date-demo` deleted** — directory gone (`ls` → no such file), and the production build's route list no longer lists `/date-demo` (was `○ /date-demo` through commit 3). The "`/date-demo` 404s" acceptance criterion holds.
- **`npm run build`** → `✓ Compiled successfully`; **`tsc --noEmit`** exit 0; **`eslint`** (SalesmanFilter + OrdersList + page.tsx) clean.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Dead CSS: `.select`.** Both native `<select>`s (salesman + date) are now gone, so `.select` in `OrdersList.module.css` is unreferenced (`grep styles.select` → none). Harmless, but prune it in the next dashboard-CSS touch to keep the module honest.
- **Visual identity of the two boxes is CSS-reasoned, not browser-rendered** (no browser this session) — both go through the same `FilterDropdown` trigger at the same default width, so identity follows structurally; still worth a glance on device that the SALESMAN value ("Mridul") and a long DATE range ellipsize the same way in the 280px box.

**Domain / correctness checks:** Money/RLS/state-machine/snapshots — **N/A** (presentational; the only data-layer change is *narrowing* two SELECTs by removing the count-join — no new columns, no write path, no RLS surface). Removing `order_items(count)` slightly lightens each query (drops a correlated aggregate). No functional data change to the rows themselves.

**What I tried:** `git show 90dc13f --stat` + full TSX/CSS/page diffs; `ls src/app/date-demo` (gone); `grep -rn order_items src/app/dashboard/` (no orphan in OrdersList/page; legit detail+pick-slip fetches present); counted header `<th>` vs body `<td>` (6=6, balanced); `grep styles.select` (dead CSS confirmed); `npx tsc --noEmit` (0); `npx eslint` on the 3 files (clean); `npm run build` (compiled successfully, `/date-demo` absent from route list). Filter-box visual identity reasoned from the shared shell (no browser).

**Open flags (cumulative):** none new. No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. **S8 orders-revamp complete + reviewer-verified across all 4 commits (3b4f861 → c76c120 → 659359b → 90dc13f, 4× ✅).**

**Next-commit suggestion:** S8 revamp is done; the two open non-blocking S8 notes worth folding into a future pass — the Phase-3-status/tab data-driven coupling (commit-3 block) and the `.select` dead-CSS prune. Otherwise the meaningful open work is M6 (deploy + pilot), which surfaces 🟡 ㉝ (migration file/version reconciliation) as the pre-deploy gate.

---

## Review of 30ac3cb — fix(dashboard): restore a small gap between the filter boxes and the table's top rule

**Verdict:** ✅ accept — a one-rule cosmetic follow-up to commit 2's flush layout, correctly scoped desktop-only, and it doesn't disturb the folder-tab connection. Build clean.

**Phase / commit goal (as I understood it):** Commit 2 pulled the whole `.filters` row flush onto the table's top rule (`margin-bottom: -12px`) so commit 3's active folder-tab could overlap it — but that also dragged the SALESMAN/DATE/search cluster down against the rule with no breathing room. This nudges just `.filterGroup` back up ~2px so only the active tab still touches the rule.

**What works (verified):**
- **Desktop-only, mobile untouched** — the new `.filterGroup { margin-bottom: 2px }` is at line 284, **inside** the `@media (min-width: 768px)` block (opens line 270, brackets the desktop `.filters`/`.table {display:table}` rules). The base `.filterGroup` (line 51, no bottom margin) is unchanged, so the mobile card layout is unaffected — consistent with the whole flush treatment being a desktop-table concern.
- **The cross-axis reasoning is correct** — `.filters` is `display:flex; align-items:center`, so a flex child's `margin-bottom` shifts it *up* on the cross axis (the margin box is what's centered). ~2px up = the intended breathing room. The active tab keeps its own `.filterTabActive { margin-bottom:-1px; z-index:1 }` overlap onto the table's `border-top`, so the folder-tab-connected-to-ledger effect is preserved — only the sibling filter cluster moves.
- **`npm run build`** → `✓ Compiled successfully`. (Pure CSS-module change; no TS/logic surface — tsc/eslint N/A to a CSS value.)

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None. Pixel result (2px of breathing room, tab still visually seated on the rule) wants a real device to confirm — the structural logic is sound and I verified placement + compile.

**Domain / correctness checks:** N/A — presentational CSS only, no data/state/money/RLS surface.

**What I tried:** `git show 30ac3cb` (1 file, +9 CSS lines); `grep` for `@media`/`.filters`/`.filterGroup`/`display: table` line numbers to confirm the new rule is inside the desktop media query (284, between 270 and 294); `npm run build` (compiled successfully). Visual result reasoned from the flex `align-items:center` model (no browser this session).

**Open flags (cumulative):** none new. No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** As before — M6 (deploy + pilot) is the meaningful open work, gated by 🟡 ㉝; the small S8 dead-CSS/`{" "}` cleanups can ride along a future dashboard-CSS touch.

---

## Review of 73111df — fix(dashboard): simplify Orders header to just the title

**Verdict:** ✅ accept — removes redundant header chrome (count/range duplicated the tab + DATE box) plus the LIVE tag per owner ask, and proactively clears the `.select` dead CSS I flagged on 30ac3cb. No orphan refs, build/tsc/eslint clean.

**Phase / commit goal (as I understood it):** Trim the Orders title row to just "Orders": drop the `LIVE` tag (owner ask — no functional loss) and the `{n} orders · {rangeLabel}` line (the count duplicates commit 3's "All N" tab; the range duplicates the DATE box's own label). Also delete the now-unused CSS (`.liveTag`, `.count`, and the `.select` I flagged last review).

**What works (verified):**
- **Header trimmed cleanly, no dangling refs** — the `LIVE` span and the count/range span are gone from `.titleRow` (now just `<h1>Orders</h1>`), and the `rangeLabel` import is removed from `OrdersList.tsx`. Grep confirms **no** `styles.liveTag` / `styles.count` / `styles.select` / `rangeLabel` reference survives *in OrdersList* — the remaining `rangeLabel` hits are DateRangeFilter's own DATE label/readout (legit), and the remaining `styles.count` is `ProductsPricing`'s separate module (unrelated). `tsc --noEmit` exit 0 confirms no broken symbol.
- **State that's still needed is retained** — removing the display didn't over-prune: `range`/`setRange` still drive `<DateRangeFilter value={range}>` and the IST filter predicate, and `finalFiltered` still feeds the table + keyboard-nav (`safeIndex`, Arrow/Enter, the `.map`). Only the *presentational* `rangeLabel(range)` call and its import went. No unused-var, no dead state.
- **Dead CSS removed** — `.liveTag`, `.count`, `.select` deleted from `OrdersList.module.css`. This **closes my 30ac3cb non-blocking note** (`.select` unused since commit 4 replaced the native `<select>`), and the builder correctly swept `.liveTag`/`.count` in the same touch now that they're unreferenced.
- **`npm run build`** → `✓ Compiled successfully`; **`tsc --noEmit`** exit 0; **`eslint OrdersList.tsx`** clean.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- The order **count** is now only visible as the "All N" tab, and the active **range** only on the DATE box — both are still on-screen, just de-duplicated, so no information is actually lost. Fine. (The `{" "}`+flex-gap cosmetic double-space in the tab labels from commit 3 is still open — trivial, whenever.)

**Domain / correctness checks:** N/A — presentational only (removed display chrome + dead CSS); no data/state-machine/money/RLS surface, and the filter/keyboard-nav logic is untouched.

**What I tried:** `git show 73111df` (2 files, all deletions/removals); `grep -rn styles.liveTag\|styles.count\|styles.select\|rangeLabel src/app/dashboard/` (no OrdersList orphan — remaining hits are DateRangeFilter + ProductsPricing, both legit); `grep value={range}\|finalFiltered` (both still used, 10 sites); `npx tsc --noEmit` (0); `npx eslint OrdersList.tsx` (clean); `npm run build` (compiled successfully).

**Open flags (cumulative):** none new. `.select` dead-CSS note (raised 30ac3cb) **✅ addressed here**. No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** M6 (deploy + pilot) remains the meaningful open work, gated by 🟡 ㉝; the last tiny S8 cosmetic (`{" "}` double-space) can ride any future dashboard touch.

---

## Review of b87f057 — design+prompt: M5.5 catalog admin (Add product + Excel import)

**Verdict:** ⚠️ accept-with-followups — a sound, tightly-scoped design (fixed-price brands only, admin-only writes, idempotent upsert on `(brand_id, tally_name)`, never-delete, ≤2-decimal money rule) whose "current state (verified against the live DB)" claims I re-verified live and found **accurate**. One wrinkle carried as ㉞: the "audit payload in **4 places across 2 files**" framing overcounts — live, `'sku'` is emitted in **2 sites inside ONE function (`update_order_items`)**; `submit_order` emits none, and `_rpcs.sql`'s copy is a *superseded* body. Docs/prompt only — no executable code, nothing broken.

**Phase / commit goal (as I understood it):** Resolve the owner's review of the Claude Design output for M5.5 and hand the builder a 4-commit plan: (1) migrate `products` to a `tally_name` key (backfill → NOT NULL → `unique(brand_id, tally_name)`), swap the order-event audit payload `sku`→`tally_name`, drop `sku`; (2) Products ledger table; (3) shared Add/Edit modal (brand-scoped category typeahead, ≤2-dec price→paise, blank-tally⇒display-name, upsert-on-dup); (4) admin-only Excel (SheetJS) import wizard with client-side diff + atomic idempotent apply. Plus a roles-and-permissions doc line making Add/Import admin-only. No executable code lands here — my job is to verify the load-bearing factual claims the builder will code against.

**What works (verified live, not read):**
- **`products` schema claims exact** — `information_schema.columns` + `pg_constraint`: `id uuid` default `gen_random_uuid()`, `brand_id uuid NOT NULL` FK→`brands(id)`, `category text NOT NULL`, `name text NOT NULL`, `sku text NOT NULL` UNIQUE (`products_sku_key`), `price_paise int NULL` CHECK `(price_paise > 0)`, `active bool NOT NULL default true`, `tally_name text NULL`, `created_at/updated_at timestamptz NOT NULL default now()`. Every column/type/nullability/constraint in the prompt's "Current state" line matches.
- **Data counts exact** — `42` rows, `34` priced, categories = exactly {Adaptors, Adaptors with Cable, Charging Cables, Earphones, Power Banks, Speakers}. The "N products · M priced" header is well-founded.
- **Security model real (the linchpin of "admin-only, no service role")** — `products_admin_insert` = INSERT `WITH CHECK (auth_profile_role() = 'admin')` (admin-only); `products_staff_update` = UPDATE USING+CHECK `auth_profile_role() IN ('accountant','admin')`. Admin holds **both** INSERT and UPDATE → the `ON CONFLICT (brand_id, tally_name) DO UPDATE` upsert the prompt specifies runs through the admin's own session, no service role. Matches the roles-and-permissions doc edit.
- **Migration applies cleanly (checked, not assumed)** — the risky step is `set tally_name not null` + `add unique(brand_id, tally_name)`. Live: `tally_name` is **already 0 nulls** (the earlier `20260707T150000_backfill_tally_name.sql` populated all 42), and there are **no** `(brand_id, tally_name)` nor post-backfill `(brand_id, coalesce(tally_name,name))` collisions. So step-1 `update … where tally_name is null` is a harmless no-op, NOT NULL succeeds, and the unique constraint takes without error. The upsert target is backed by the very constraint Commit 1 creates — coherent.
- **Repo pointers accurate** — `ProductsPricing.tsx:155` renders `{p.sku}`; `products/page.tsx:23` selects `sku`; the whole-rupee validation `/^\d+$/` to replace is at `ProductsPricing.tsx:60`; UI primitives `Field.tsx`/`Button.tsx` exist in `src/components/ui/`; `formatRupees` at `format.ts:99`.

**Blocking issues (must fix in next commit):** None — docs/prompt commit; nothing executable to break.

**Non-blocking suggestions / followups (→ ㉞):**
- **The audit-payload swap is smaller and more delicate than "4 places across 2 files" reads.** Ground truth from `pg_get_functiondef` on the LIVE DB: `'sku'` appears in **2 sites, both inside `update_order_items`** (the `before` + `after` per-item snapshots); `submit_order`/`process_order`/`cancel_order` emit **0**. My grep found **6** `'sku'` sites (not 4 — the prompt omits two in `20260706T150800_rename_current_role.sql` L163/L213), but all six are the *same function* across three successively-superseding definitions. At Commit 1 the builder must:
  1. **Recreate only `update_order_items`** — do **not** touch `submit_order` (nothing to swap; recreating risks a needless regression).
  2. **Copy from the CURRENT body, not `_rpcs.sql`.** The prompt lists `20260706T150400_rpcs.sql` (L166/L219) first, but that's the *original 3-arg* `update_order_items`, superseded twice; the live body is `20260707T120000_update_order_items_reason.sql` (4-arg, with the mandatory-`p_reason`-after-lock logic — ㉘). `create or replace` from the **current** body with the two `sku`→`tally_name` swaps; copying `_rpcs.sql`'s body would silently drop `p_reason` and regress ㉘.
  3. **Swap goes in the NEW migration only** — don't edit the already-applied files (immutability).
- **Perpetuates ㉝.** The new `<ts>_catalog_admin.sql` uses the same non-standard `T`-timestamp / apply-via-MCP pattern flagged in ㉝, and it does DDL (`drop column sku`, add constraints) + `create or replace` of an RPC — exactly the surface a `supabase db push` reconciliation must handle before M6. Fold this migration into the ㉝ dry-run.
- **Minor precision:** the guardrail "Admin has RLS `ALL` on products" — there is no literal `ALL` policy; admin's access is composed (INSERT via `products_admin_insert` + UPDATE via `products_staff_update` + SELECT via `products_select_staff`; **no DELETE**). Since the design forbids delete-on-import this doesn't mislead, but "ALL" is loose.

**Domain / correctness checks:**
- **Money math** ✓ — ≤2-decimals→paise (₹557.5 → 55750, reject >2-dec) with `formatRupees` display, replacing the old whole-rupee `/^\d+$/`×100, is correct integer-paise discipline (store paise, format en-IN for display).
- **Immutable snapshots** ✓ — swapping the audit key changes only the *label* on *new* `order_events`; old events keep their `sku` key (prompt says so); historical `order_items` snapshots untouched. No retro-mutation.
- **Idempotency** ✓ — upsert on `(brand_id, tally_name)` + "re-run = all Updated, never delete" is the right idempotent-import contract, backed by the unique constraint.
- **RLS** ✓ — admin-only INSERT / staff UPDATE quals verified live; no service-role escalation in the plan.
- **Catalog integrity** — dropping `sku` removes the old identity; `(brand_id, tally_name)` becomes the catalog key + Tally join, consistent with the Tally-export direction. Watch at Commit 1 that the event-catalog + seed-data docs get the promised `{ tally_name, qty, unit_price_paise }` update.

**What I tried:**
- `git show b87f057` (3 files, +83/-1; no code) — read the full prompt + design-resolutions + roles-doc diff.
- Repo grep: `jsonb_build_object … 'sku'` → **6** sites in 3 files; mapped each to its owning function via the `create … function` line numbers → **all six inside `update_order_items`**. Confirmed `ProductsPricing.tsx:155`/`:60`, `page.tsx:23`, `src/components/ui/{Field,Button}.tsx`, `format.ts:99`.
- Live DB (MCP `execute_sql`, read-only): `pg_get_functiondef` `'sku'`-count per RPC → `submit_order 0 / update_order_items 2 / process_order 0 / cancel_order 0`; `information_schema.columns` + `pg_constraint` for the full `products` shape; `count(*)`=42 / priced=34 / 6 categories; `pg_policy` quals for `products_admin_insert` (WITH CHECK admin) + `products_staff_update` (accountant+admin); collision probe → `null_tally=0`, no `(brand_id, tally_name)` or `(brand_id, coalesce(tally_name,name))` dups.

**Open flags (cumulative):** **㉞ new** (M5.5 audit-payload swap: really 2 sites in `update_order_items` only — copy from the current 4-arg `p_reason` body, not `_rpcs.sql`; verify at Commit 1). No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation — this new migration folds into its dry-run), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 1 (backend: `tally_name` key + audit swap + drop `sku`). I'll verify by execution that only `update_order_items` was recreated (from the current `p_reason` body), that a submitted **and** edited test order emits `tally_name` in `order_events`, that `unique(brand_id, tally_name)` rejects a dup, that `sku` is gone, and that the app still compiles with the `page.tsx`/`ProductsPricing.tsx` `sku` refs removed.

---

## Review of fe1bef9 — fix(m5.5-prompt): correct the sku→tally_name audit swap per reviewer ㉞

**Verdict:** ✅ accept — resolves ㉞ precisely; every corrected claim re-checked against this session's live ground truth and matches. Also closes my minor "RLS ALL" precision nit. Docs/prompt only.

**Phase / commit goal (as I understood it):** Fix the M5.5 builder prompt + design-doc so the Commit-1 audit-payload swap targets reality: only `update_order_items` emits `sku`; recreate it from its **current 4-arg `p_reason` body**, not the superseded copies; leave the other RPCs untouched; and tighten the loose "RLS `ALL`" wording.

**What works (verified):**
- **Correct function scope** — new text: "only `update_order_items` emits `sku` (2 sites); `submit_order`/`process_order`/`cancel_order` emit none." Matches my live `pg_get_functiondef` count verbatim (submit 0 / update 2 / process 0 / cancel 0). "Recreate **only** `update_order_items`, don't touch the others" is right.
- **Correct copy-source** — "its live definition is the 4-arg `p_reason` body in `20260707T120000_update_order_items_reason.sql`, which supersedes the 3-arg copies in `20260706T150400_rpcs.sql` / `20260706T150800_rename_current_role.sql` — do NOT copy from those (regresses ㉘)." Exactly the trap ㉞ named; and the builder correctly folded in `_rename_current_role.sql` — the file the *original* prompt omitted (I flagged those extra 2 sites) — to the don't-copy list. "Change only its **two** `'sku'` sites" — right count.
- **RLS wording fixed** — "Admin holds INSERT (`products_admin_insert`) + UPDATE (`products_staff_update`) + SELECT (no DELETE — there is no literal `ALL` policy), so the upsert runs through the admin's own session — no service role." Matches the live policy quals I pulled; closes my precision nit.
- **Acceptance tightened** — now checks the **edit** emits `tally_name` (not `sku`), `submit_order` unchanged, and the ㉘ `p_reason`-after-lock guard still fires. All correct verification targets.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- Micro-nit: the acceptance line reads "`submit_order` is unchanged … and **its** `p_reason`-after-lock guard (㉘) still fires" — the `p_reason` guard lives in `update_order_items`, not `submit_order`, so "its" has a loose antecedent. Harmless (the three checks it names are each correct actions); no action needed.

**Domain / correctness checks:** N/A — prompt/doc text only; the *substance* (which function, which body, how many sites, the RLS composition) now matches live exactly, which was the whole point of the fix.

**What I tried:** `git show fe1bef9` (2 files, +4/−4); re-checked each corrected claim against this session's live audit — `pg_get_functiondef` `'sku'`-count per RPC (submit 0 / update 2 / process 0 / cancel 0), the live 4-arg `update_order_items(p_order_id, p_notes, p_items, p_reason)` signature, and the `products_admin_insert` (WITH CHECK admin) / `products_staff_update` (accountant+admin) policy quals. All corrected text matches ground truth.

**Open flags (cumulative):** **㉞ ✅ CLOSED** at fe1bef9 (swap now targets `update_order_items` only, from the current `p_reason` body; RLS wording corrected). No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation — the pending `20260707T170000_catalog_admin.sql` in the working tree folds into its dry-run), ㉛ (order_no_seq grant hardening — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 1 (the backend migration — `20260707T170000_catalog_admin.sql` is already staged in the working tree). I'll verify by execution: only `update_order_items` recreated, from the 4-arg body, its 2 `sku` sites → `tally_name`, `p_reason` guard intact; a submitted **+ edited** test order emits `tally_name`; `unique(brand_id, tally_name)` rejects a dup; `sku` dropped; types regenerated; build clean.

---

## Review of 1e81d48 — feat(products): M5.5 c1 — (brand_id, tally_name) catalog key, swap order audit key sku→tally_name, drop sku

**Verdict:** ✅ accept — the M5.5 backend groundwork, executed carefully and **proven live**: the migration applied cleanly, **only** `update_order_items` was recreated (from the current 4-arg `p_reason` body, both `sku` sites → `tally_name`, the ㉘ guard intact), the other three order RPCs untouched, `sku` dropped, and `(brand_id, tally_name)` enforces uniqueness. Old `order_events` (sku key) still render via a `tally_name ?? sku` reader. tsc/eslint/build clean. Implements ㉞'s corrected plan exactly.

**Phase / commit goal (as I understood it):** M5.5 Commit 1 — make `(brand_id, tally_name)` the catalog key (backfill `tally_name` → NOT NULL → `unique(brand_id, tally_name)`); swap the order-event audit payload from the invented `sku` to `tally_name` by recreating the one function that emits it; drop `sku`; keep the app compiling by removing every `sku` reference; regenerate types; update the order-lifecycle + seed-data specs.

**What works (verified by execution against the live DB):**
- **Schema migrated (live-confirmed):** `information_schema` / `pg_constraint` → `sku` column **gone** (with its `products_sku_key`), `tally_name` **NOT NULL**, `products_brand_tally_key unique (brand_id, tally_name)` **present**. The key rejects a dup — I attempted an `insert` of an existing `(brand_id, tally_name)` inside a rolled-back block → `duplicate key value violates unique constraint "products_brand_tally_key"`.
- **Only `update_order_items` recreated, correctly:** live `pg_get_functiondef` → `update_order_items` emits `'sku'` **0** / `tally_name` **4** (= 2 payload sites × key+column), signature still 4-arg `(p_order_id, p_notes, p_items, p_reason)`. `submit_order` / `process_order` / `cancel_order` still **0** `sku` (untouched — not in the migration). Migration body = the 4-arg `p_reason` version verbatim (recreate-before-drop, with a comment on the plpgsql late-binding hazard), swapping only the two `jsonb_build_object` sites (`-- was 'sku', p.sku`).
- **Live edit emits `tally_name`, guard intact (rolled-back real call):** impersonated the admin profile (`set_config('request.jwt.claims', …)`) and called `update_order_items` on a real submitted-past-window order, then **RAISE-aborted so the txn rolled back** — persistence re-checked after: the order's latest event is still `items_changed/reason=null`, my test left **no trace**. Result: `action=edited_after_lock`; **`after` snapshot has `tally_name`, no `sku`**; **`before` snapshot also `tally_name`** (both sites); `details.reason` recorded my test string → the ㉘ mandatory-reason-after-lock guard still fires. First item = `{"tally_name":"ADAPTOR (MA108B WHITE)","qty":3,"unit_price_paise":38000}` — exactly the `{ tally_name, qty, unit_price_paise }` shape the updated event catalog documents.
- **App compiles + old events still render:** no residual `sku` field refs in `src/` (grep); `order-events.ts` reads `l.tally_name ?? l.sku ?? "item"` so PRE-M5.5 events (old `sku` key) render alongside new ones — good backward-compat; `page.tsx` drops `sku` from the interface + select and types `tally_name: string`; `tsc --noEmit` clean, `eslint` clean on all 7 changed files, `npm run build` exit 0 (full route list intact).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- `ProductsPricing.save()` writes `tally_name: form.tallyName.trim() || products.find(x => x.id === id)?.name` — the optional-chained `?.name` is nominally `string | undefined`; it's safe (supabase-js omits an `undefined` field, and `tally_name` already satisfies NOT NULL, so no null write — and `id` always matches a prop row), but a `?? p.name`-style non-optional fallback reads cleaner. Moot after Commit 3 replaces this inline card with the modal. Trivial.
- **㉝ interaction:** this migration (`20260707T170000_catalog_admin.sql`, T-timestamp, applied via MCP) joins the reconciliation set, and its DDL is non-idempotent (`drop column sku` / `add constraint` would error on re-apply). The pre-M6 `db push` dry-run must confirm ordering + that already-applied migrations aren't re-run.

**Domain / correctness checks:**
- **Immutable snapshots** ✓ — swap changes only the audit *label* on **new** events; historical `order_items` and old `order_events` (sku key) untouched and still render.
- **Money math** ✓ — `unit_price_paise` unchanged (integer paise); live event showed `38000` correctly.
- **State machine** ✓ — recreated function preserves salesman-window / `edited_after_lock` / cancelled-reject / mandatory-reason logic (admin past-window → reason required + recorded, verified live).
- **RLS** ✓ — `update_order_items` remains `security definer` with `grant execute … to authenticated`; no policy weakened.
- **Catalog integrity** ✓ — `(brand_id, tally_name)` is now a real unique key (Tally-name-based), replacing the invented sku; consistent with the Tally-export direction.

**What I tried:** `git show 1e81d48` (migration + 10 files); live `execute_sql` — schema/constraint state; `pg_get_functiondef` `sku`/`tally` counts + signature for all four order RPCs; a **rolled-back** admin `update_order_items` call reading the emitted `order_events` (RAISE-abort pattern) + a persistence re-check; a **rolled-back** dup-insert probing `products_brand_tally_key`; repo grep for residual `sku`; `order-events.ts` reader; `tsc --noEmit`; `eslint` (7 files); `npm run build` (exit 0, full route list).

**Open flags (cumulative):** No 🔴 blocking. ㉞ remains **✅ CLOSED** (closed at fe1bef9; **implemented exactly here** — proven live). Carried 🟡 ㉝ (pre-M6 migration reconciliation — **this migration joins the set**: non-idempotent DDL + T-timestamp/MCP-version mismatch), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 2 (Products ledger table) — already landed as `01e575d`; reviewing next, oldest-first.

---

## Review of 01e575d — feat(products): M5.5 c2 — Products catalog ledger + inline ACTIVE toggle

**Verdict:** ✅ accept — replaces the grouped price-edit cards with the S8-grammar ledger (# · BRAND · CATEGORY · DISPLAY · TALLY · PRICE · ACTIVE) to spec; preserves the ㉜🅐 render-from-prop + ㉜🅑 stay-busy-through-refresh patterns; money via `formatRupees`/TBD; the only write is the inline ACTIVE toggle (permitted for accountant+admin by `products_staff_update`). Isolated tsc / eslint / build clean.

**Phase / commit goal (as I understood it):** M5.5 Commit 2 — rework the Products page into the design's ledger table (screen 1): 7 columns, header "Products · N products · M priced", PRICE = `formatRupees`-or-TBD, a BRAND column from `brands(name)` (no Zebronics hardcode), an inline ACTIVE toggle; defer price/tally/name editing + "+ Add product" to the c3 modal.

**What works (verified):**
- **Ledger to spec** — desktop `<table>` with exactly # · BRAND · CATEGORY · DISPLAY NAME · TALLY NAME · PRICE · ACTIVE (7 `<th>` = 7 `<td>` balanced; the "8th" `<th>` in a grep is `<thead>`). Mobile `.cards` fallback + empty state ("No products in the catalog."); `rowInactive` styling when `!p.active`.
- **Counts derived at render** — `const priced = products.filter(p => p.price_paise !== null).length` → header `{products.length} products · {priced} priced`; not hardcoded, recomputes from the prop; "products", not "SKUs".
- **Money display correct** — `p.price_paise === null ? TBD : formatRupees(p.price_paise)` in both table + card (paise→rupees en-IN; raw paise never shown). No money is *written* here anymore — the old `/^\d+$/` whole-rupee `save()` is **deleted** (price editing moves to the c3 modal with the ≤2-dec rule), so that stale validation is gone by removal.
- **㉜🅐 render-from-prop preserved** — renders straight from `initialProducts` (no `useState` copy), so a post-write `router.refresh()` repaints with fresh data. **㉜🅑 stay-busy** — per-row `busyId` disables only the toggled row; `startTransition(() => { router.refresh(); setBusyId(null); })` clears busy after the refresh is queued (mirrors `RetailersQueue.setActive`). No whole-table dim, no stale-row bug.
- **ACTIVE toggle + RLS** — `supabase.from("products").update({ active: !p.active }).eq("id", p.id)` via the browser session; `products_staff_update` (USING+CHECK `role IN (accountant, admin)`, verified live at ㉞) permits both. On error: clears busy + surfaces `updateError.message`. Writes only `active`.
- **BRAND column** — `page.tsx` select adds `brands(name)`; row renders `p.brands?.name ?? "—"`; `ProductRow` gains `brands: { name: string } | null`.
- **Compiles** — isolated `tsc --noEmit` on a throwaway `git worktree` at 01e575d = clean (the live checkout already carried the builder's in-flight c3 files, so I isolated c2 to test it honestly, then removed the worktree); `eslint` clean; the session `npm run build` (includes c2) exit 0. Removed `Field`/`Button` imports are fully unused now — no dangling refs.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- The `brands(name)` embed is cast `as unknown as ProductRow[]`. For a to-one forward FK (products.brand_id → brands), PostgREST returns `brands` as an **object** (or null) at runtime, so `p.brands?.name` is correct — the double-cast just papers over the generated types modelling the embed as an array. The one thing I couldn't verify headlessly is that the brand name actually paints (vs "—") in a browser; low risk given the standard to-one shape, worth an eyeball on the deployed screen.
- `#` is a render ordinal (`index + 1`) over the (category, name)-sorted list — fine for a ledger, but it renumbers if a filter/sort is added later; not a stable catalog number.
- Toggle label shows the pre-write state until the refresh lands (button busy meanwhile) — correct per ㉜🅑 (no optimistic flip); just noting the ~one-refresh visual latency.

**Domain / correctness checks:**
- **Money math** ✓ — display-only via `formatRupees` (integer paise → rupees); no float, no raw paise, and no money written on this screen.
- **RLS** ✓ — ACTIVE write goes through `products_staff_update` (accountant+admin); no admin-only surface here (the admin-only INSERT is c3/c4).
- **render-from-prop (㉜🅐/🅑)** ✓ — preserved and correctly applied to the toggle.
- **Catalog integrity** ✓ — every brand's rows shown via the BRAND column; Zebronics not hardcoded.
- Immutable snapshots / state machine — N/A (no order surface).

**What I tried:** `git show 01e575d` (3 files); `git worktree add --detach <tmp> 01e575d` + symlinked node_modules → isolated `tsc --noEmit` clean (then `worktree remove`); `eslint` on the two source files; column-count grep (7 = 7); confirmed the write-path + the `products_staff_update` qual (accountant+admin, from the live pull at ㉞); session `npm run build` (exit 0, includes c2).

**Open flags (cumulative):** No 🔴 blocking. No new flags. Carried 🟡 ㉝ (pre-M6 migration reconciliation — M5.5 c1's migration in the set), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (㉞ closed.)

**Next-commit suggestion:** Commit 3 (row-click Add/Edit modal) — already landed as `26005d5`; reviewing next. Will verify the ≤2-dec→paise price rule, blank-tally⇒display-name, brand-scoped category typeahead + normalize, admin-only "+ Add" (upsert-on-dup), and accountant read-only name/category.

---

## Review of 26005d5 — feat(products): M5.5 c3 — shared Add/Edit product modal (admin add · row-click edit)

**Verdict:** ✅ accept — the shared Add/Edit modal is correct and well-built: the money parser (`parsePricePaise`) + normalizers are **node-verified across 21 boundary cases**, the admin-only Add is **server-enforced** (accountant INSERT is RLS-blocked, proven live), the upsert-on-`(brand_id, tally_name)` matches the owner's dup rule, blank-tally→display-name + category-fold work. One non-blocking flag ㉟: the accountant's name/category read-only lock is **UI-only** (the DB allows an accountant to UPDATE those columns — proven live) — fine for a trusted role, worth recording. Isolated tsc/eslint clean.

**Phase / commit goal (as I understood it):** M5.5 Commit 3 — one shared form for Add (admin-only, upsert on the catalog key) and Edit (row-click, UPDATE by id): brand dropdown (locked on edit), brand-scoped category typeahead (disabled until brand chosen, normalize on save), display name, tally (blank⇒display name), price (≤2-dec→paise), active; accountant edits price/tally/active only, admin edits all.

**What works (verified):**
- **Money parser — node-tested (compiled `src/lib/price.ts`), all pass:** `₹557.5→55750`, `557.55→55755`, `0.29→29` and `19.99→1999` (float-round edges), `"  12.50  "→1250` (trim), blank→`null` (TBD); rejects `557.555` (">2 decimals" msg), `abc`, `.5`, `557.`, `-5`, and `0`/`0.00` (">0", matching the `price_paise > 0` CHECK). Single source of truth now — the old whole-rupee `/^\d+$/` is fully gone.
- **Normalize + tally — node-tested (`src/lib/catalog.ts`):** `normalizeCategory("speakers", ["Speakers",…]) → "Speakers"`, `"  SPEAKERS " → "Speakers"`, new kept as-typed; `effectiveTallyName("", "Widget") → "Widget"`, whitespace→display name, non-blank kept.
- **Admin-only Add is server-enforced (live RLS probe):** impersonated the accountant (role `authenticated` + jwt claims) and attempted `insert into products` → **`new row violates row-level security policy`** (rolled back). So Add isn't just a hidden button — `products_admin_insert` (WITH CHECK admin) blocks a non-admin INSERT at the DB, so the upsert's INSERT path is safe even if the UI gate were bypassed. Admin holds INSERT+UPDATE → the upsert runs in their own session.
- **Upsert on the catalog key** — Add → `.upsert({…}, { onConflict: "brand_id,tally_name" })`; a dup key UPDATEs the existing row (owner decision), backed by `products_brand_tally_key`. Edit → `.update(payload).eq("id", …)` (no upsert, no dup risk).
- **Accountant vs admin fields** — `nameLocked = mode==="edit" && !isAdmin` disables name+category for the accountant **and omits them from the UPDATE payload**; `brandLocked = mode==="edit"` locks brand for all; admin edits everything; Add only reachable by admin (`{isAdmin && …}`).
- **Validation** — required brand/displayName/category + `parsePricePaise` errors surface as a red strip + red `Field`s (never amber); blank price ⇒ TBD.
- **Wiring** — `categoriesByBrand` (useMemo over the catalog prop) feeds the typeahead + normalize; row-click (table + card) opens Edit; the ACTIVE toggle `stopPropagation`s so it doesn't open the modal; card has role/tabIndex/Enter-Space a11y; `onSaved` → close + `router.refresh()` (render-from-prop shows fresh data); `page.tsx` fetches user+brands+role in parallel, passes `isAdmin`.
- **Compiles** — isolated `tsc --noEmit` + `eslint` on a `git worktree` at 26005d5 = clean (the live checkout carried c4-in-flight, so I isolated c3).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **㉟ (new): accountant name/category "read-only" is UI-only.** Proven live (rolled back): as the accountant, `update products set name=…` **applied** — `products_staff_update` (USING/CHECK `role in (accountant, admin)`) permits an accountant UPDATE on *any* column; RLS is row-level, not column-level. The modal correctly omits name/category from the accountant payload, so through the app they can't — but a direct API call could. Acceptable for a trusted back-office role and consistent with the app's row-level posture; hardening (a column GRANT, or a trigger/RPC rejecting staff name/category changes) is an owner call, not required now.
- Editing a row's tally into another product's `(brand, tally)` surfaces the raw Postgres unique-violation text rather than a friendly "a product with that Tally name already exists." Minor polish.
- `page.tsx` uses `user!.id` (non-null assertion) — safe behind the dashboard auth gate, but a guard would be tidier. `catBlurTimer` isn't cleared on unmount (harmless 120 ms timer). Trivial.

**Domain / correctness checks:**
- **Money math** ✓ — node-verified; single source of truth (`parsePricePaise`); `≤0` rejected to match the CHECK.
- **RLS/auth** ✓ — admin-only INSERT enforced live; accountant UPDATE allowed (name/category lock UI-only → ㉟).
- **Catalog integrity** ✓ — `(brand_id, tally_name)` upsert key + category normalize prevents near-dups; blank tally never stored.
- Immutable snapshots / state machine / money-server-recompute — N/A (catalog admin surface, not orders).

**What I tried:** `git show 26005d5` (7 files); compiled `price.ts`/`catalog.ts` → node harness, **21 assertions all PASS**; isolated `git worktree` at 26005d5 → `tsc --noEmit` + `eslint` clean; two **live rolled-back RLS probes** as the accountant (INSERT → RLS-blocked ✓; UPDATE name → applied, proving the UI-only lock); read ProductModal + the ProductsPricing/page wiring diffs.

**Open flags (cumulative):** **㉟ new** (🟡 accountant name/category read-only is UI-only — DB allows it; owner's call to harden). No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 4 (Excel import wizard) — already landed as `52dcf8a`; reviewing next. Will verify SheetJS parse/diff keyed on `(brand, effective-tally)`, error-row skip + valid-row **atomic** apply, **idempotent** re-run (all Updated, no dups), never-deletes (untouched line), admin-only, and template round-trip.

---

## Review of 52dcf8a — feat(products): M5.5 c4 — Excel import wizard (Upload → Preview → Result, admin-only)

**Verdict:** ✅ accept — the import wizard is complete and correct to spec, and the atomic apply is **proven live**: `import_products` is `security definer` + admin-guarded (accountant rejected), a single-transaction upsert on `(brand_id, tally_name)` with a correct `xmax=0` added/updated split, **idempotent** (re-run = all Updated), and **never deletes**. Client parse/diff keys on `(brand, effective-tally)`, degrades honestly, and the preview table scrolls in-container on phone. tsc/eslint/build clean. No blocking issues; a few edge nits.

**Phase / commit goal (as I understood it):** M5.5 Commit 4 — admin-only 3-step Excel wizard: SheetJS parse of the first sheet, client-side diff vs the brand's fresh catalog (New/Updated/Error), atomic idempotent apply via a new `import_products` RPC, never-delete + untouched report, template download, unreadable-file state; Import button beside "+ Add product", both admin-only. Adds `xlsx`.

**What works (verified):**
- **`import_products` RPC — proven live (rolled back):** as **admin**, a 2-row payload (1 novel tally + 1 existing) → `{added:1, updated:1}`; an immediate **re-run** → `{added:0, updated:2}` (idempotent, no dups); catalog 42→43 within the txn (one INSERT), rolled back to 42 (no leak, no delete). As **accountant** → `only admin may import products`. Server-enforced admin gate (defense-in-depth beyond the button), correct `xmax=0` split, `security definer` + `set search_path=public,pg_temp`, brand-exists check, single-txn (a bad file can't half-corrupt).
- **Admin-only surface** — Import button under `{isAdmin && …}` beside "+ Add product"; RPC `execute` is granted to `authenticated` but the body rejects non-admins.
- **Parse + classify** — first sheet (`sheet_to_json {header:1, blankrows:false}`); requires Category + Display Name headers else "unreadable"; skips fully-blank rows; classifies vs the **freshly-fetched** brand catalog keyed on **effective tally** (blank⇒display name): New / Updated / Error (missing display name | blank category | bad price via `parsePricePaise`). Valid rows carry `normalizeCategory` + paise; `rowNo` is the real spreadsheet row.
- **Preview honesty** — New/Updated/Errors summary (accent/ink/red, no amber); error rows show an inline reason; untouched line ("N products … left untouched (deactivate discontinued ones manually)"); Apply degrades: clean ⇒ "Apply import · N rows", errors ⇒ "Apply K valid rows" + "Z error rows will be skipped"; disabled at 0 valid. Apply sends only non-error rows; Result = Added/Updated/Skipped(=error count).
- **Phone** — `.tableScroll { overflow-x:auto; border… }` scrolls the wide table in its own container, not the page body.
- **Money** — Price coerced via shared `parsePricePaise` (₹557.5→55750; blank⇒TBD); template example is a numeric `557.5`; price_paise sent integer|null; the RPC's `case … is null then null else ::integer` preserves TBD.
- **Compiles/builds** — `npm run build` exit 0 (full route list incl. /dashboard/products); tsc/eslint clean (current checkout = c4 tip).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Intra-file duplicate tally:** two file rows folding to the same effective tally (both absent from the DB) are each classed **New** in the preview, but the RPC upserts them in-loop (2nd hits ON CONFLICT against the 1st) → Result shows added=1/updated=1. Non-corrupting + deterministic (last-row-wins), just a preview↔result mismatch — worth a de-dup-in-preview later.
- **Untouched count** counts error-row tallies as "in file", so an existing product mentioned only in an error row isn't counted "untouched." Defensible (it *is* in the file), minor.
- **No Escape-to-close** on ImportWizard (ProductModal has one) — small inconsistency; scrim/✕ still close it.
- **Thin applier:** `import_products` trusts the client's normalize/tally-fold/price-parse and takes category/price as-is — safe because admin-only + DB constraints (tally NOT NULL, `price_paise > 0`) abort a bad payload atomically; if ever exposed wider, move normalize/parse server-side.

**Domain / correctness checks:**
- **Money math** ✓ — shared `parsePricePaise`; integer paise end-to-end; TBD preserved; `formatRupees` display.
- **Idempotency** ✓ — proven live (re-run all Updated, zero dups).
- **RLS/auth** ✓ — admin-only (RPC gate + `products_admin_insert`); accountant rejected live.
- **Catalog integrity / never-delete** ✓ — upsert-only; absent products reported, not touched (count grew only by the new row).
- **Atomicity** ✓ — single-function txn; a failing row aborts the whole import.
- Immutable snapshots / state machine — N/A.

**What I tried:** `git show 52dcf8a` (8 files); read the `import_products` migration + `ImportWizard.tsx`; **live rolled-back probes** — admin 2-row + idempotent re-run (`{added:1,updated:1}`→`{added:0,updated:2}`, 42→43→rollback), accountant reject; confirmed the `{isAdmin}` Import gate, `.tableScroll` overflow, `xlsx ^0.18.5`; `npm run build` exit 0.

**Open flags (cumulative):** No 🔴 blocking. No new flags (c4 nits are edge/cosmetic, in-block). Carried 🟡 ㉟ (accountant col-lock UI-only — owner's call), ㉝ (pre-M6 migration reconciliation — **c4's `20260707T180000_import_products.sql` also joins the set**), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** M5.5 is functionally complete (c1–c4 all ✅). Pre-M6: the ㉝ dry-run must now cover **both** new migrations (`…T170000_catalog_admin`, `…T180000_import_products`). Also a real-device wizard pass (drag-drop, phone full-screen sheet, template round-trip) — the browser-only bits I can't exercise headlessly.

---

## Review of dfd8a46 — docs(roles): record ㉟ — accountant name/category lock is UI-only, not RLS-enforced

**Verdict:** ✅ accept — accurately records ㉟ in the roles prose + the `products` RLS matrix; every claim matches what I proved live, and the D11 reference is valid (a real, defined decision). Closes ㉟ as documented / owner-accepted.

**Phase / commit goal (as I understood it):** Reconcile the roles doc with ㉟ — state plainly that the accountant's name/category "read-only" is a UI convention (the Add/Edit modal omits those fields), not an RLS guarantee, because `products_staff_update` is row-level (whole-row); tie it to D11 (admin/accountant separation is convention, not enforcement); note the real-enforcement path (a `BEFORE UPDATE` trigger on `auth_profile_role()`) without building it.

**What works (verified):**
- **Doc now matches live reality** — both the prose and the `products` RLS-matrix row say the accountant UPDATE is whole-row (name/category updatable at the DB); the "price/tally/active only" limit is a UI convention (㉟). Exactly what my live probe showed (accountant `update … set name=…` **applied**; accountant INSERT **RLS-blocked**). No overclaim — it still correctly credits `products_admin_insert` for the enforced admin-only Add/Import.
- **D11 is a real decision, not a dangling ref** — `docs/decisions.md:98` defines D11 ("Admin/accountant stay functionally identical in-app; oversight-only is a convention, not an enforced permission"); the new "same shape as D11 … left as-is by that decision" is consistent with it and with the existing roles-doc §that already cites D11.
- **Enforcement path correct** — a `BEFORE UPDATE` trigger rejecting name/category changes when `auth_profile_role() = 'accountant'` is exactly the column-level mechanism RLS can't express; "nothing in the app relies on that today" is accurate.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None — a faithful record of the ㉟ finding + the owner's accept-as-is posture.

**Domain / correctness checks:** RLS/auth ✓ — the doc's statements about `products_staff_update` (row-level, accountant+admin) and `products_admin_insert` (admin-only) match the live policy quals I pulled and probed this session. No other surface touched.

**What I tried:** `git show dfd8a46` (1 doc file); `grep -rn D11 docs/` → D11 defined at `decisions.md:98` (reference valid); cross-checked the doc's RLS claims against this session's live probes (accountant UPDATE name applied; accountant INSERT blocked; policy quals from ㉞).

**Open flags (cumulative):** **㉟ ✅ CLOSED** at dfd8a46 — documented in the roles doc + RLS matrix, tied to D11, left as-is by owner decision (enforcement path noted, unbuilt). No 🔴 blocking. Carried 🟡 ㉝ (pre-M6 migration reconciliation — now covers both M5.5 migrations), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** M5.5 fully complete + documented (c1–c4 ✅, ㉟ closed). Remaining pre-M6 work: the ㉝ migration-reconciliation dry-run (now covering `…T170000` + `…T180000`) and a real-device wizard/modal pass.

---

## Review of 76a817f — design+prompt: Phase 3a fixed-price multi-brand order flow

**Verdict:** ✅ accept — a well-researched, accurate design/prompt: every load-bearing claim (schema state, the current `order_ref` format + how `submit_order` builds it, `order_no_seq`, the reused `FilterDropdown`/`SalesmanFilter`, the 4-arg RPC signatures, the referenced design-doc sections) verified true against live + repo, and the plan is coherent + genuinely backward-compatible on the shared prod DB. I pre-checked the Commit-1 migration is safe to apply. No inaccuracies; a few commit-time watch-items. Docs/prompt only.

**Phase / commit goal (as I understood it):** Phase 3a design resolutions (salesman brand selection = in-Quick-Order dropdown + lazy auto-lock, brand-as-hyper-category, two-tier sticky headers) + a 3-commit prompt: (1) backend — `brands.code`, `orders.brand_id` (derived server-side, unchanged RPC signatures), one-brand submit-guard, `ORD-<code>-<year>-<no>` ref; (2) Quick Order brand UI; (3) dashboard column/filter + pick-slip + detail. Fixed-price only (no LG/approval — Phase 3b).

**What works (verified live + repo):**
- **Schema state exact** — `orders` has **no** `brand_id` (has `order_no int`, `order_ref text NOT NULL`); `brands` = {id, name, active}, **no** `code`; `products.brand_id` present, **1 distinct brand (Zebronics)**; `order_no_seq` exists. Matches the "Current state" line-for-line.
- **Backward-compat is real (the linchpin)** — current `submit_order` sig = `(p_id, p_retailer_id, p_notes, p_items)`; its body builds `v_order_ref := 'ORD-' || to_char(now at IST,'YYYY') || '-' || v_order_no` and already loops items looking up `v_product`. So deriving the distinct brand server-side + swapping only the ref *expression* is a clean in-body change with the **signature unchanged** → a no-brand client (deployed `main`) keeps submitting. "Don't change the signature, derive brand_id from items" is coherent, not hand-wave.
- **Ref facts** — existing refs are `ORD-2026-1008…1002` (`ORD-<IST year>-<order_no>`), so "historical stay ORD-2026-xxxx" is accurate; `order_ref` already has a **unique** constraint, and Option A's single global `order_no_seq` keeps the new brand-coded ref unique across brands. IST-year is already the convention.
- **Commit-1 migration safe to apply (pre-checked live):** 7 orders, **0 zero-item** + **0 mixed-brand** → `orders.brand_id` backfill-then-NOT-NULL succeeds and `distinct brand_id … limit 1` is unambiguous; `brands.code` NOT NULL+unique is trivial at 1 brand.
- **Code refs accurate** — `QuickOrder.tsx` exists with the live-measured sticky category headers (the "add the brand-header height" nested-sticky note is well-founded); `FilterDropdown.tsx` + `SalesmanFilter.tsx` exist (the "reuse that pattern" is valid); design-doc sections "The one real schema change" / "Order refs — Option A (recommended)" / "Salesman brand selection" all present.
- **㉘/㉞ carried forward correctly** — the prompt says copy the current 4-arg `p_reason` `update_order_items` body (don't regress ㉘) and notes the audit payload already emits `tally_name` (㉞) — both true; the ㉞ lesson is applied proactively.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions / commit-time watch-items:**
- **Shared LIVE/prod DB.** One Supabase project, owner live-testing Zebronics on it. Commit 1's migration is additive/backward-compat (safe — verified), but still a prod mutation; **Commit 2's test-brand is the real hazard** — a stray second brand + priced products would leak straight into the owner's Quick Order. The prompt's guardrail (disposable brand on a Supabase dev branch, or only when the owner isn't mid-test, then remove/deactivate) is exactly right; **I'll verify the live catalog is clean of test data after Commit 2** (leftover = a blocking data-hygiene issue then).
- **㉝ interaction:** the new `<ts>_multi_brand.sql` (T-timestamp, MCP-applied) joins the ㉝ reconciliation set — fold into the pre-M6 `db push` dry-run alongside `…T170000` / `…T180000`.
- **Commit-1 placement watch:** the brand-derivation + guard must sit in `submit_order`'s new-order insert path (after the existing `if found then return v_order` idempotency early-return, so a re-submit stays a no-op) and set `brand_id` before the ref build. I'll check at Commit 1.

**Domain / correctness checks:**
- **Immutable snapshots / historical refs** ✓ — the prompt forbids mutating stored `order_ref`s; only new orders get the brand-coded form. Consistent with immutability.
- **State machine / money / RLS** ✓ — unchanged by design; brand is an added attribute, not a lifecycle/price change; the server guard (not just UI) is the enforcement wall (matches the RPC-is-the-boundary posture I proved for M5.5).
- **Order numbering (D1)** ✓ — Option A keeps the single global `order_no_seq` (gaps OK, never reset); ref uniqueness rides on the global `order_no`.
- **One-brand guard** — enforced server-side in both RPCs (UI lock is belt-to-suspenders). Correct place for the invariant.

**What I tried:** `git show 76a817f` (2 files, +64/−1); live `execute_sql` — `orders`/`brands` columns, `products` distinct brands (1=Zebronics), `order_no_seq` exists, both RPC signatures, `submit_order` full body (current ref expression), recent `order_ref` sample (`ORD-2026-100x`), migration-safety probe (0 zero-item, 0 mixed-brand, `order_ref` unique); repo — `QuickOrder.tsx`/`FilterDropdown.tsx`/`SalesmanFilter.tsx` exist + QuickOrder sticky-header code; design-doc section presence.

**Open flags (cumulative):** No 🔴 blocking. No new ledger flag (design accurate, migration pre-verified safe). Carried 🟡 ㉝ (pre-M6 migration reconciliation — **Phase-3a's `_multi_brand.sql` will join the set**), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Watch (not yet flags): shared-DB test-brand cleanup after Commit 2; `submit_order` guard placement at Commit 1.

**Next-commit suggestion:** Commit 1 (backend). I'll verify by execution: signature byte-for-byte unchanged; a **no-brand** client still submits (backward-compat); all-Zebronics submit → `brand_id` set + `ORD-ZEB-2026-xxxx`; crafted **mixed-brand** submit → rejected; `update_order_items` foreign-brand line → rejected with the ㉘ `p_reason` guard intact; existing 7 orders backfilled to Zebronics; build clean.

---

## Review of baa3509 — prompt(phase3a): add commit 4 — Products mobile Brand-Category sticky grouping + de-dup cards

**Verdict:** ✅ accept — a small, accurate frontend-only prompt addition whose rationale is verified against live + repo. Adds Commit 4 to the Phase-3a prompt: apply commit-2's Brand ▸ Category two-tier sticky grouping to the admin Products **mobile card** view and slim the cards; desktop table unchanged.

**Phase / commit goal (as I understood it):** Extend the Phase-3a prompt with a 4th commit — group the Products mobile cards under Brand ▸ Category sticky headers (mirroring commit 2's Quick Order), drop the now-redundant brand/category from the card body, show the Tally line only when `tally_name !== name`; preserve M5.5's render-from-prop + row-click-edit + inline-Active (㉜🅐/🅑); desktop table untouched.

**What works (verified):**
- **The redundancy claim is real** — `ProductsPricing.tsx:174` mobile card renders `{p.brands?.name ?? "—"} · {p.category} · {p.tally_name}`, exactly the "brand · category · tally_name" the prompt targets.
- **"Tally echoes the display title" is empirically true** — live: **42/42 products have `tally_name == name`** (0 differ). So today every card's tally line duplicates its title verbatim; "show Tally only when it differs" correctly hides it across the whole current catalog while still surfacing a genuinely distinct tally later. The desktop table keeps its own TALLY column (`:130`), so nothing is lost there.
- **Scope + flag refs accurate** — frontend-only (ProductsPricing card view + CSS), desktop table unchanged, and the ㉜🅐/🅑 (render-from-prop + stay-busy toggle) + row-click-edit behaviours it says to preserve are the real M5.5 patterns.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** At build time watch that the nested sticky (brand-header height added to the category bar's `top`) is genuinely shared with / consistent with commit 2's Quick Order, and that the slimmed card keeps the Active toggle's `stopPropagation` (so grouping headers/cards don't swallow the toggle or the row-click edit). Phone check for sticky overlap (the classic failure).

**Domain / correctness checks:** N/A — prompt/doc text only; no data/RLS/money/state surface. The tally-hide is display-only; the stored `tally_name` key is untouched.

**What I tried:** `git show baa3509` (+8 lines); confirmed `ProductsPricing.tsx:174` card-meta line + desktop tally column at `:130`; live `select count(*) filter (where tally_name=name)` → **42/42** equal (rationale holds).

**Open flags (cumulative):** No 🔴 blocking, no new flags. Carried 🟡 ㉝ (pre-M6 migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Phase-3a Commit 1 (backend brand attribute + guard + ref) — verification plan in the 76a817f block (signature unchanged, no-brand client still submits, mixed-brand rejected, ㉘ guard intact, 7 orders backfilled).

---

## Review of a101f55 — feat(orders): phase3a c1 — brand as first-class order attribute + single-brand guard + brand-coded ref

**Verdict:** ❌ **reject** — the DDL and `update_order_items` are correct, but **`submit_order` is broken on the live shared DB**: it calls `min(p.brand_id)` on a `uuid` column and this Postgres has **no `min(uuid)` aggregate** → `function min(uuid) does not exist` on **every** new-order submission (even a plain single-item order). Production order creation is down — the deployed `main` app's salesmen can't submit. **Fix in the very next commit.** The commit's "Verified live … ref ORD-ZEB-2026-999" claim is contradicted by execution (the function throws before it ever builds a ref).

**Phase / commit goal (as I understood it):** Phase 3a Commit 1 — additive backend: `brands.code`, `orders.brand_id` (derived server-side, unchanged RPC signatures), single-brand `submit_order` guard + `ORD-<code>-<year>-<no>` ref, an `update_order_items` brand guard; keep the shared-DB `main` client working.

**🔴 Blocking issues (must fix in next commit):**
- **`submit_order` crashes on `min(uuid)` — production submit is DOWN.** Body line: `select count(distinct p.brand_id), min(p.brand_id) into v_brand_count, v_brand_id …`. `min(uuid)` is not a function on this instance — verified directly (`select min(brand_id) from public.products` → `function min(uuid) does not exist`). This runs for every genuinely-new order (after the idempotency early-return), so **all** new submissions fail: I proved it with a single-brand 2-item probe **and** a plain 1-item probe (`single_item_submit=[function min(uuid) does not exist]`). The currently-deployed app cannot create orders on the shared prod DB right now.
  - **Verified fix (both tested live):** replace `min(p.brand_id)` with **`(array_agg(distinct p.brand_id))[1]`** (cleanest — pairs with the `count(distinct …)` already there) or `max(p.brand_id::text)::uuid`. Recreate `submit_order` (same signature) with the swap in the next migration; **keep the DDL columns — only the function body is wrong.**
- **Commit-message accuracy:** "Verified live: … single-brand→distinct 1, ref ORD-ZEB-2026-999, mixed set→distinct 2 (submit rejects)" is **false** — the live `submit_order` can't execute. Re-run the actual `submit_order` in the fix's probe so the log stays trustworthy (the REVIEWER verifies claims literally).

**What IS correct (verified live — keep it):**
- **DDL right + safe:** `brands.code='ZEB'` NOT NULL + `brands_code_key` unique; `orders.brand_id` **7/7 backfilled to Zebronics**, NOT NULL, `orders_brand_id_fkey` FK → brands(id). Only `submit_order`'s body needs fixing — do **not** revert the columns.
- **Signatures unchanged** — `submit_order(p_id, p_retailer_id, p_notes, p_items)`, `update_order_items(p_order_id, p_notes, p_items, p_reason)`. Backward-compat *intent* is right (once the crash is fixed, a no-brand client works).
- **`update_order_items` is fine** — its brand guard is a join-based `exists(… where p.brand_id <> v_order.brand_id)` (no uuid aggregate). Proven live (rolled back): a **same-brand** edit **succeeds**; a **foreign-brand** line is **rejected**; ㉞ `tally_name` audit key + ㉘ mandatory-`p_reason`-after-lock guard both preserved.
- **`submit_order` structure** (aside from the crash): idempotency early-return correctly precedes the brand logic (watch-item ✓); guard raises on `count(distinct)>1`; no-existing-product → per-line 'not orderable'; ref = `'ORD-'||code||'-'||IST-year||'-'||order_no`; historical refs untouched. All correct **once `min(uuid)` is replaced**.

**Non-blocking suggestions:** Defer until the blocker lands — nothing material beyond the fix.

**Domain / correctness checks:**
- **Order creation / state machine** 🔴 — submit path broken (blocking).
- **One-brand guard** ✓ — submit logic correct modulo the crash; edit guard proven live.
- **Immutable refs** ✓ — historical `ORD-2026-xxxx` untouched.
- **Money / RLS / snapshots** ✓ — unchanged; edit still snapshots + emits `tally_name`.
- **Numbering (D1)** ✓ — single global `order_no_seq`.

**What I tried:** `git show a101f55` (migration + types); live `execute_sql` — column/constraint state (brands.code, orders.brand_id FK+NOT NULL, 7/7 Zeb), both RPC signatures, `update_still_tally`/`reason`=true; **rolled-back probes**: single-brand submit → **`function min(uuid) does not exist`**; direct `min(brand_id)` unsupported + both fix candidates return a uuid; plain 1-item submit → same crash; same-brand `update_order_items` → **success** (id 91d9686c…); foreign-brand edit → correctly rejected. All rolled back (brands still 1, orders still 7).

**Open flags (cumulative):** **🔴 ㊱ NEW — `submit_order` `min(uuid)` crash; production order submission DOWN on the shared live DB; fix next commit.** Carried 🟡 ㉝ (migration reconciliation — `_multi_brand.sql` + the forthcoming fix migration join the set), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** **Immediately** recreate `submit_order` (same signature) replacing `min(p.brand_id)` with `(array_agg(distinct p.brand_id))[1]`; re-probe live — single-brand submit succeeds with `brand_id` set + `ORD-ZEB-2026-<no>`; mixed-brand rejected; the deployed no-brand client submits. **No new functionality until this lands.**

---

## Review of 17c9956 — fix(orders): phase3a ㊱ — submit_order crashed on min(uuid), restore submission

**Verdict:** ✅ accept — ㊱ fixed and **verified by execution**: `submit_order` creates orders again (single-brand → `ORD-ZEB-2026-1010`, `brand_id`=Zebronics, `status`=submitted), mixed-brand still rejected, signature unchanged. Production submission restored — closes the 🔴 blocker.

**Phase / commit goal (as I understood it):** Fix the ㊱ crash — replace `min(p.brand_id)` (no `min(uuid)` aggregate → runtime crash on every submit) with `array_agg(distinct p.brand_id)[1]`; body + signature otherwise identical.

**What works (verified live, rolled back):**
- **submit_order restored** — impersonated a salesman and called the real `submit_order` with two Zebronics products → **succeeded**: `order_ref=ORD-ZEB-2026-1010`, `brand_id`=Zebronics, `status=submitted`. No crash. (This is also the backward-compat path — no brand param passed; brand derived.)
- **Mixed-brand still rejected** — a submit spanning a temp 2nd brand + Zebronics → `all items in an order must be the same brand`. The single-brand guard survived the fix.
- **Fix is correct** — `select array_agg(distinct p.brand_id) into v_brand_ids …`; `if coalesce(array_length(v_brand_ids,1),0) > 1 then raise …`; `v_brand_id := v_brand_ids[1]`; null → 'not orderable'. `array_agg(distinct)` sidesteps the missing `min(uuid)`; the `>1` length check is equivalent to the old `count(distinct)>1`. The only residual `min(` in the body is the explanatory comment (`-- has no min() aggregate — use array_agg…`), not executable — confirmed by substring + by the function actually running.
- **Signature unchanged** — `(p_id, p_retailer_id, p_notes, p_items)`; migration-only commit (no app/types change) → compiles as before; DDL + `update_order_items` untouched (both verified correct at a101f55).
- **Honest commit message** — candidly explains why the c1 probe missed it (it computed the brand via `min(code)` on *text*, which exists, not the real `min(brand_id)` on *uuid* path). Log trustworthy again.

**Blocking issues (must fix in next commit):** None — the blocker is cleared.

**Non-blocking suggestions:**
- My verification (and the builder's) advanced `order_no_seq` a few counts (my probe minted …1010), so real orders will show a small gap — **fine per D1 (gaps by design; never reset the sequence).** Noting so a gap isn't mistaken for lost orders.
- ㉝: this fix migration (`…T193000_fix_submit_order_minuuid.sql`) also joins the reconciliation set.

**Domain / correctness checks:**
- **Order creation / state machine** ✅ — restored + verified (submit succeeds; correct brand + ref + status).
- **One-brand guard** ✓ — mixed-brand rejected live.
- **Numbering (D1)** ✓ — single global `order_no_seq`; gaps OK.
- **Money / RLS / snapshots / immutable refs** ✓ — unchanged.

**What I tried:** `git show 17c9956` (1 migration); live rolled-back probes — single-brand `submit_order` → `ORD-ZEB-2026-1010`/brand set/submitted; mixed-brand → rejected; `pg_get_functiondef` shows `array_agg(distinct)` present and the residual `min(` is the comment (substring-confirmed); signature unchanged; brands still 1, orders still 7.

**Open flags (cumulative):** **🔴 ㊱ ✅ CLOSED** at 17c9956 — `submit_order` restored (array_agg fix), verified live. **No 🔴 blocking.** Carried 🟡 ㉝ (migration reconciliation — `_multi_brand` + `_fix_submit_order_minuuid` join the set), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Phase-3a Commit 2 (Quick Order brand UI) — already landed as 029ffa4; reviewing next. Will verify the brand dropdown + Brand▸Category two-tier sticky grouping + lazy auto-lock, and — critically — the shared-DB **test-brand hygiene** (no stray brand/products left in the live catalog).

---

## Review of 029ffa4 — feat(new-order): phase3a c2 — Quick Order brand dropdown, Brand▸Category grouping, lazy auto-lock

**Verdict:** ✅ accept — correct and, crucially, **the single-brand path (the owner's live Zebronics flow) is provably unchanged**: all brand UI is gated behind `multiBrand = brandOptions.length >= 2`, false with one brand. Lazy auto-lock is derived from the cart (no imperative state); two-tier nested sticky is implemented. tsc/eslint/build clean. **Test-brand hygiene respected** — no 2nd brand provisioned, live catalog still Zebronics-only (verified). The multi-brand *runtime* visuals can't be exercised without a 2nd brand + a browser — the one residual.

**Phase / commit goal (as I understood it):** Phase 3a Commit 2 — in-Quick-Order brand selection: a plain `<select>` beside the search (≥2 brands only), "All brands" nesting Brand▸Category with two-tier sticky headers, pick-to-filter, add-first-item lazy auto-lock (disable select + narrow list + cue), empty-cart unlock; submit unchanged.

**What works (verified):**
- **Single-brand path unchanged (safety-critical):** `multiBrand` false at 1 brand ⇒ no `<select>`, `showBrandTier=false` ⇒ flat `allCategories` (old rendering via the extracted `renderCategory`), no `lockNote`, `.listTwoTier` off ⇒ `--brand-offset:0` ⇒ category bar pins at `--search-bar-height` exactly as before; `visible` = all products either way. The owner's live flow is byte-identical behaviour; only cosmetic copy changed (de-SKU'd placeholder/empty-state).
- **Lazy auto-lock is derived, not stateful** — `cartBrandId = first cart line's brand`; `locked = cartBrandId !== null`; select `value`/`disabled` + the list filter all read from it; empty cart ⇒ unlocked. No imperative lock effect to desync. `effectiveBrand = locked ? cartBrandId : (brandFilter==="all"?null:brandFilter)`.
- **Grouping correct** — `brandGroups` nests Brand▸Category from `visible` (brands alphabetical, categories encounter-order); `showBrandTier = effectiveBrand===null && multiBrand`; picked/locked ⇒ flat categories. Same-named categories across brands don't collide (each under its brand `<section>`); React keys unique among siblings. The memo deps `[products, items, brandFilter, query]` cover every input to `visible`/`effectiveBrand`.
- **Two-tier nested sticky implemented** — `.brandHeader` sticky `top: var(--search-bar-height)` z9; category bar `top: calc(var(--search-bar-height) + var(--brand-offset))` z8; `.listTwoTier` sets `--brand-offset: var(--brand-header-height)`. (All referenced classes present at HEAD — checked.)
- **page.tsx** — selects `brand_id, brands(name)`, flattens `brand_name` (`r.brands?.name ?? ""`, standard to-one embed). Ordering unchanged.
- **Submit unchanged** — server derives + guards brand (c1, verified live). UI lock is belt-to-suspenders.
- **Compiles** — `tsc --noEmit` clean, `eslint` clean, `npm run build` exit 0.
- **Test-brand hygiene ✓ (my c1/c2 watch-item)** — live catalog still **Zebronics-only** (`brand_count=1`, `non_zeb_products=0`); the builder deliberately did NOT provision a 2nd brand (would leak into the owner's live Quick Order). Responsible.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **`--brand-header-height: 34px` is a hardcoded estimate**, unlike the search bar's live ResizeObserver measurement. If the brand header's real rendered height differs (long/wrapping brand name on a narrow phone, font metrics), the two sticky tiers can slightly overlap/gap — and the design called two-tier sticky "the fiddly part." Consider live-measuring the brand header too, or confirm 34px holds across brand-name lengths on a real phone.
- **Multi-brand runtime unverified** — the dropdown, nested-sticky, lazy lock/unlock, and the narrowed cue only exist with ≥2 brands, which don't exist live (deliberately). I verified compile + single-brand-unchanged + logic-by-reading; the visual/interaction pass needs a browser + a temporary 2nd brand (dev branch, not prod). Real-device residual.

**Domain / correctness checks:**
- **One-brand-per-order** ✓ — UI lock prevents adding a foreign brand (list filters to the locked brand); server is the real wall (c1). Belt-and-suspenders.
- **Money / snapshots / ㉕** ✓ — `renderCategory` preserves the exact product row, pricing (`pricesById`), stepper/keypad, and the ㉕ unavailable-line handling; cart/price path unchanged.
- **RLS** ✓ — catalog still RLS-scoped (active+priced); brand list derived from the visible catalog.

**What I tried:** `git show 029ffa4` (QuickOrder.tsx + page.tsx + CSS); traced the single-brand path (multiBrand gate) + lazy-lock derivation; confirmed every referenced CSS class exists at HEAD (`.brandHeader`/`.listTwoTier`/`.brandSelect`/`.lockNote`/`.searchRow` + `--brand-offset`) and working-tree == 029ffa4; live catalog hygiene (1 brand, 0 non-Zeb products); `tsc --noEmit` + `eslint` clean; `npm run build` exit 0.

**Open flags (cumulative):** No 🔴 blocking. No new ledger flag. Carried 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Residual (not a flag): multi-brand runtime + `--brand-header-height` need a real-device / 2nd-brand pass.

**Next-commit suggestion:** Phase-3a Commit 3 (dashboard BRAND column + BrandFilter + pick-slip + detail). I'll verify the BrandFilter composes with the date/salesman filters + tab counts (single-brand-today: the column shows, the filter has one option). Then c4 (Products mobile grouping). Also queued: bf0ad3b (future-plans docs) — reviewing next, oldest-first.

---

## Review of bf0ad3b — docs(future-plans): fulfillment & serial/QR capture at dispatch (Phase 4+)

**Verdict:** ✅ accept — a well-formed parking-lot entry (owner-approved, explicitly TBD / Phase-4+); cross-refs resolve, placement is right, and it introduces no contradiction with current state or decisions. Docs only.

**Phase / commit goal (as I understood it):** Record the owner's fulfillment/serial-capture idea in future-plans.md — a new godown/warehouse role scans each unit's serial at dispatch, the accountant keys them into Tally where the bill is then created (so the Tally invoice is generated at *dispatch* off captured serials, not at order time); mandatory for LG, optional elsewhere. Structure TBD, gated on Phase 2 (Tally) + Phase 3b (LG).

**What works (verified):**
- **Correct home + framing** — appended to future-plans.md's "approved in principle but deliberately not scheduled" parking lot, alongside geotag / RLS-pass / cancelled-orders-view / Payments-tab. Every claim is hedged TBD and dependency-gated — matches the doc's "decided shape + context, not a build spec" contract.
- **Cross-references resolve** — `phase2-tally-sync-design.md` exists (the "refines the app→Tally trigger" ref); the geotag entry it points to ("carry the parked order-submit geotag as proof-of-delivery") exists at future-plans.md:5, and that entry's idempotency pin (`submit_order` retries don't update the geotag) stays consistent — a dispatch/fulfilled state is a *separate later event*, nothing conflicts.
- **No stale contradiction** — the note "(Corrects the earlier 'salesman scans' sketch.)" leaves nothing dangling: grep finds **no** surviving "salesman scans" text in docs/. The GODOWN-not-salesman correction is clean.
- **Internally consistent + technically sound** — the new `warehouse`/`godown` role is additive (doesn't touch the current salesman/accountant/admin model); `order_item_serials` (per-unit, additive) fits the immutable-snapshot posture; the `BarcodeDetector` feasibility note (Android Chrome yes / iOS Safari no) is accurate; the "Tally bill at dispatch, off serials" refinement is flagged as *refining* (not overriding) the Phase-2 trigger and left undecided.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- When this graduates from the parking lot, fold the "Tally bill created at *dispatch*, not order-time" refinement INTO phase2-tally-sync-design.md itself (the voucher-trigger timing currently lives only in this forward note) so the Phase-2 design and this entry don't drift on when the voucher fires. Not needed now — at scheduling time.

**Domain / correctness checks:** N/A — planning doc; no code/data/RLS/money/state surface. The described `order_item_serials` + `warehouse` role are additive and consistent with the state-machine/snapshot model when eventually built.

**What I tried:** `git show bf0ad3b` (1 doc, +21); confirmed `docs/phase2-tally-sync-design.md` exists, the geotag entry + its idempotency pin exist in future-plans.md (ref resolves), no surviving "salesman scans" sketch (grep), and the entry sits in the parking-lot section.

**Open flags (cumulative):** No 🔴 blocking, no new flags. Carried 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Phase-3a Commit 3 (dashboard BRAND column + BrandFilter + pick-slip + detail) and c4 (Products mobile grouping) — the remaining Phase-3a UI. For c3 I'll verify the BrandFilter composes with the date/salesman filters + tab counts.

---

## Review of 94c6556 — feat(dashboard): phase3a c3 — surface brand (ledger column + filter, detail views, pick slip)

**Verdict:** ❌ **reject** — not for the code (correct + verified), but because the commit **left a test brand in the owner's LIVE catalog**: "Calvin Klein" (code CK, active) with **3 active, priced products** (Obsession/Eternity/Sense). Right now they're **salesman-visible in the owner's live Quick Order**, and `multiBrand` has flipped **true for real salesmen** (the c2 brand dropdown + two-tier grouping now show unexpectedly). Exactly the shared-DB hazard the prompt forbade + my c2/c3 watch-item pinned. **Remove/deactivate the CK brand + its 3 products before anything else lands** — safe to delete (0 orders / 0 order_items reference it, verified).

**Phase / commit goal (as I understood it):** Phase 3a Commit 3 — surface brand across the dashboard: a BrandFilter (shared FilterDropdown) folded into the ledger's scoped filter + tab counts, a BRAND column + mobile-card brand (multiBrand-gated), and brand in the workbench (S9), salesman detail (S7), pick slip (S10).

**🔴 Blocking issue (must fix before anything else lands) — ㊲:**
- **Test brand polluting the live catalog.** Live now has **2 brands** — Zebronics (ZEB) + **Calvin Klein (CK, active)** — and **3 active+priced CK products** (`salesman_visible_nonzeb=3`). Effects on the owner's *live* system: (a) salesmen see Obsession/Eternity/Sense in Quick Order (`products_select_salesman` = active AND priced); (b) `salesman_visible_brand_count=2` ⇒ **`multiBrand` true** ⇒ the Quick Order brand dropdown + Brand▸Category grouping (c2) render for real salesmen; (c) the dashboard BRAND column/filter (this commit) show. The commit message states it outright: "CK test brand now present, so the multiBrand paths render live." The prompt required a **disposable** brand on a **dev branch**, or provisioned only when the owner isn't testing, **removed/deactivated afterward** — this left it live. **Remediation (safe — `ck_orders=0`, `ck_order_items=0` verified):** delete the 3 CK products then the CK brand, or set them `active=false`. I did **not** clean it up myself (I don't mutate prod, and you may want to inspect it first).

**What IS correct (verified — the code is fine, keep it):**
- **BrandFilter** mirrors SalesmanFilter on the shared `FilterDropdown` (controlled open, close-on-pick, reuses its option CSS); "All brands" + options; valueLabel right.
- **Filter composition** — the brand predicate folds into `scoped` (`if (brandId !== "all" && o.brand_id !== brandId) return false`), *before* tab-counting, so per-tab counts + range + salesman all compose with brand. Correct two-stage placement.
- **multiBrand gating symmetric** — filter, `<th>BRAND`, `<td>`, and the mobile-card suffix are all gated `{multiBrand && …}`, so column balance holds and a single-brand ledger is byte-identical to before. (`multiBrand = brands.length >= 2`, from the active-brands fetch.)
- **page.tsx** — `ORDERS_SELECT` + page query add `brand_id, brands(name, code)`; a parallel active-brands fetch; `DashboardOrderRow`/`BrandOption` typed + passed.
- **Detail + pick slip** — workbench byline (`{order.brandName && …}`), salesman detail subline (`order.brands ? NAME · … : ""`), pick-slip `slipBrand` under the ref — all null-safe conditional displays; the three loaders add `brands(name, code)` + a `brandName` prop.
- **Compiles** — `tsc --noEmit` clean.

**Non-blocking suggestions:** (after the blocker) — none material; the code is solid.

**Domain / correctness checks:**
- **Data hygiene / live-catalog integrity** 🔴 — test brand + products live (blocking).
- **Filter/tab-count composition** ✓ — brand folded into `scoped`, counts reflect it.
- **RLS** ✓ — ledger still `orders_select_staff`-scoped; brand list = active brands.
- **Money / state machine / snapshots** ✓ — display-only additions, no write/price/lifecycle change.
- **Column balance** ✓ — symmetric multiBrand gating.

**What I tried:** live `execute_sql` — **found the CK brand + 3 active priced products** live (`brand_count=2`, `salesman_visible_nonzeb=3`, `salesman_visible_brand_count=2`); blast radius (`ck_orders=0`, `ck_order_items=0` → safe to delete); `git show 94c6556` (BrandFilter/OrdersList/page + 5 detail/pick-slip files) — traced the scoped-filter fold, symmetric multiBrand gating, null-safe brand displays; `tsc --noEmit` clean.

**Open flags (cumulative):** **🔴 ㊲ NEW — CK/Calvin Klein test brand + 3 active priced products left in the LIVE catalog (salesman-visible, flips multiBrand for real users); remove/deactivate before anything else lands (safe: 0 order refs).** No other 🔴. Carried 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Residual: multi-brand real-device visual pass.

**Next-commit suggestion:** **Remove the CK test brand + its 3 products from live** (delete — no order refs — or deactivate), then confirm live: `brand_count` back to 1, salesman Quick Order Zebronics-only (multiBrand false again), dashboard BRAND column/filter hidden. Only then proceed. (Note: c4 e544d5b already landed on top of the polluted DB — ㊲ still applies; I'll re-check the cleanup when reviewing c4.)

---

## Review of e544d5b — feat(products): phase3a c4 — mobile Brand▸Category sticky grouping + de-duplicated cards

**Verdict:** ⚠️ accept-with-followups — c4's **code is correct and verified** (tsc/eslint/build clean; Brand▸Category mobile grouping, card de-dup, and the ㉜🅐/🅑 + row-click-edit patterns all preserved via the shared `renderCard`; desktop table untouched). But it's new UI on the open 🔴 ㊲ base — its two-tier brand grouping only renders live *because* the CK test brand is still polluting the catalog. **🔴 ㊲ (remove the CK test brand) remains the gating blocker and must be cleared next.**

**Phase / commit goal (as I understood it):** Phase-3a Commit 4 (per baa3509) — group the admin Products *mobile card* view under Brand▸Category two-tier sticky headers, slim the cards (brand+category → headers; Tally line only when `tally_name !== name`); desktop table unchanged; preserve render-from-prop + row-click-edit + inline-Active.

**What works (verified):**
- **Mobile grouping correct** — `mobileGroups` nests Brand▸Category from `products` (brands alphabetical, categories encounter-order), memoized on `[products]`; `multiBrandProducts = mobileGroups.length >= 2` gates the brand tier; render is `brand section → category section → renderCard`. Keys unique among siblings (brandId / category / p.id).
- **Card de-dup to spec** — brand+category dropped from the card body (now in sticky headers); Tally line shows only when `p.tally_name !== p.name` (matches baa3509; live data has all Zebronics tally==name so no echo). Card keeps name + price/TBD + Active toggle.
- **㉜🅐/🅑 + row-click-edit preserved** — the extracted `renderCard` renders from the prop (no useState copy), keeps the `busyId` stay-busy toggle with `stopPropagation`, and the row-click / Enter-Space edit. Same behaviour as c3's inline card, relocated + grouped.
- **Single-brand = category-grouped (intended), desktop untouched** — with one brand: no brand header, `cardsTwoTier` off (`--pm-offset:0`), category headers only. (This does add category grouping to the single-brand mobile view vs the old flat list — an intended improvement per the prompt, not a regression.) The desktop `<table>` is byte-unchanged.
- **Compiles** — `tsc --noEmit` + `eslint` clean; `npm run build` exit 0.

**🔴 Blocking (carried from c3, not introduced by c4): ㊲** — the CK test brand + 3 active priced products are **still live** (re-checked: `brand_count=2`, `ck_salesman_visible=3`). c4's brand tier renders "live" only because of this. **Must be removed before the phase is done / before further commits.** (c4 was committed before ㊲ was posted, so not a c4 protocol miss — but it's now the standing blocker.)

**Non-blocking suggestions:**
- **`--pm-offset: 34px` hardcoded** (same as c2's `--brand-header-height`) — not live-measured. If the brand header's real height differs (long brand name / font metrics), the two sticky tiers can overlap/gap on a phone. Same real-device check as c2; consider one shared measured value.

**Domain / correctness checks:**
- **Money** ✓ — `formatRupees`/TBD unchanged in `renderCard`.
- **render-from-prop / inline-active (㉜)** ✓ — preserved.
- **RLS / state machine / snapshots** — N/A (presentational admin view).
- **Data hygiene** 🔴 — ㊲ carried (CK brand live).

**What I tried:** `git show e544d5b` (ProductsPricing.tsx + CSS); traced `mobileGroups` + `renderCard` + the `multiBrandProducts` gate; re-checked live catalog → ㊲ still open (CK brand + 3 salesman-visible products); `tsc --noEmit` + `eslint` clean; `npm run build` exit 0.

**Open flags (cumulative):** **🔴 ㊲ OPEN (carried) — CK test brand in live catalog; remove/deactivate next.** No other 🔴. Carried 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Residual: multi-brand real-device visual pass (Quick Order + Products mobile two-tier sticky).

**Next-commit suggestion:** **Clear 🔴 ㊲ first** — remove the CK/Calvin Klein test brand + 3 products from live (delete: 0 order refs; or deactivate), confirm `brand_count=1` + salesman Quick Order Zebronics-only. That closes Phase-3a's functional work (c1–c4 code all ✅ once ㊲ is clean); then the pre-M6 ㉝ migration-reconciliation dry-run (now 3 phase-3a migrations) + a real-device multi-brand visual pass.

---

## Review of 34d6231 — merge: Phase 3a fixed-price multi-brand into main (c1–c4 + ㊱ fix)

**Verdict:** ✅ accept (clean integration) — a conflict-free merge of the fully-reviewed Phase-3a work into `main`: `git diff afdaa4e 34d6231 -- src/ supabase/` is **empty** (main's code + both migrations exactly match the reviewed feature tip), no conflict markers, tsc clean, my c1–c4 review blocks preserved in comments.md. **No unreviewed code entered main.** ⚠️ But it promoted Phase-3a to the **deployed** branch while 🔴 ㊲ is still open (grown 3→4 CK products) — the shared DB means deployed main now surfaces the CK test brand to the owner's salesmen. **㊲ cleanup is now urgent.**

**Phase / commit goal (as I understood it):** Integrate the Phase-3a feature branch (c1 brand attribute + ㊱ fix, c2 Quick Order brand UI, c3 dashboard brand, c4 Products mobile grouping) into `main`.

**What works (verified):**
- **Clean union** — `git diff afdaa4e (feature tip) 34d6231 -- src/ supabase/` is empty ⇒ main's application code + the two migrations (`_multi_brand`, `_fix_submit_order_minuuid`) are byte-identical to the reviewed tip. No merge-resolution drift, no extra code.
- **No conflicts** — grep finds no `<<<<<<<`/`=======`/`>>>>>>>` markers.
- **Review log preserved** — comments.md merged (+259) with the c1–c4 review blocks intact on main (c3 + c4 present).
- **Compiles on main** — `tsc --noEmit` clean post-merge (c1–c4 already build-verified individually).
- **㊱ fix on main** — `_fix_submit_order_minuuid.sql` is in the merge, so main carries the `array_agg` fix, not the crashing `min(uuid)` version.

**🔴 Blocking (carried, elevated): ㊲** — the CK/Calvin Klein test brand + now **4** active priced products are **still in the shared live catalog** (`brand_count=2`, `ck_salesman_visible=4` — grew since c3). The merge means **deployed main** renders the multi-brand UI against this polluted catalog: the owner's salesmen see the fake CK products in Quick Order + the brand dropdown. **Remove/deactivate the CK brand + products** (safe — 0 orders reference them). DATA fix, not code — the merged code is sound; ㊲ is the sole remaining gate and now touches production.

**Non-blocking suggestions:** Process — a 🔴-blocked phase ideally shouldn't reach the deployed branch until the blocker clears; here the blocker is live-data (㊲), so the merged code is fine, but the deployed exposure makes ㊲ cleanup time-sensitive.

**Domain / correctness checks:**
- **Merge integrity** ✓ — clean union, no unreviewed code, both migrations present.
- **Data hygiene** 🔴 — ㊲ (CK pollution) now on deployed main.
- Money / RLS / state machine — unchanged (verified per-commit).

**What I tried:** `git show 34d6231 --stat` (20 files = c1–c4 + 2 migrations + comments.md); `git diff afdaa4e 34d6231 -- src/ supabase/` (empty — clean union); conflict-marker grep (none); confirmed c3/c4 review blocks on main; `tsc --noEmit` clean; re-checked live catalog → `ck_salesman_visible=4` (㊲ grew, still open).

**Open flags (cumulative):** **🔴 ㊲ OPEN — CK test brand + 4 active priced products in the shared live catalog, now surfaced by *deployed* main; remove/deactivate (safe: 0 order refs).** Carried 🟡 ㉝ (migration reconciliation — 3 phase-3a migrations to reconcile before a real `db push`), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** **Clear 🔴 ㊲** — remove the CK brand + its (now 4) products from the shared DB; confirm `brand_count=1` + salesman Quick Order Zebronics-only. Then Phase-3a is functionally complete + deployed clean; remaining pre-M6 = the ㉝ dry-run (3 migrations) + real-device multi-brand visual pass.

---

## Review of dc04359 — prompt: Phase 3b — LG manual pricing + admin approval (3 commits)

**Verdict:** ✅ accept — an accurate, well-scoped design/prompt: every load-bearing "Current state" claim verified live, and it carries the prior review lessons forward well (backward-compat signature-stable RPCs, don't-regress ㉘/㉞, ≤2-dec money, admin-only at BOTH the RPC and the guard trigger, shared-prod-DB caution). Docs/prompt only. I've pinned two Commit-1 details the prompt implies but doesn't spell out, plus the two invariants I'll verify by execution.

**Phase / commit goal (as I understood it):** Phase 3b — enable manual-pricing brands (LG): salesman types the per-line price, orders gated behind admin approval. Backend (pricing_mode/requires_approval flags, pending_approval/approved states, approve_order + process_order/guard gating, manual-product RLS visibility) → salesman manual-price entry → dashboard Pending-approval tab + admin Approve.

**What works (verified live + repo):**
- **Current-state claims exact:** `orders_status_check = ('submitted','processed','cancelled')` (to widen); `brands.pricing_mode`/`requires_approval`, `orders.approved_at`/`approved_by` all **absent** (to add); `process_order` + `guard_order_transition` **exist**, `approve_order` does **not** (new); brands = **Zebronics (ZEB) + Luminous (LUM)**, both fixed. Matches the prompt line-for-line.
- **The RLS relax target is exactly as stated** — live `products_select_salesman` qual = `auth_profile_role()='salesman' AND active AND price_paise IS NOT NULL`. The plan (`… OR brand.pricing_mode='manual'`) widens *only* manual-brand visibility while keeping fixed-brand unpriced hidden (D2). This is the **security-sensitive** change — I'll verify at Commit 1 that fixed-brand unpriced products STAY hidden (a regression would leak unpriced Zebronics/Luminous to salesmen).
- **Guard edges consistent** — live `guard_order_transition` allows only `submitted→processed|cancelled` and `processed→cancelled` (else raises). The prompt's added edges (`pending_approval→approved` [admin], `pending_approval→cancelled`, `approved→processed`, `approved→cancelled`) + default-reject of `pending_approval→processed` / `submitted→approved` fit the guard's allow-list model. The guard currently has **no role logic**, so adding the "non-admin `→approved` rejected" check (via `auth_profile_role()`) is a real addition — the prompt calls it out; sound as double-enforcement with `approve_order`'s `v_role='admin'`.
- **Lessons carried forward** — signature-stable/backward-compat RPCs (optional per-line price key; no-price clients unchanged) mirror the Phase-3a discipline; "copy the current 4-arg `p_reason` `update_order_items`, don't regress ㉘/㉞" applies the exact ㊱/㉞ lesson; ≤2-dec→paise is the M5.5 rule; additive migration on the shared prod DB (existing brands default fixed/no-approval) is the right posture.
- **Trust boundary framed correctly** — manual lines take the client price (validate `>0` + ceiling, no floor); fixed lines snapshot from catalog and **ignore** client price ("untamperable"). The core security invariant.

**Blocking issues (must fix in next commit):** None (docs/prompt).

**Non-blocking — Commit-1 details the prompt implies but doesn't spell out (I'll check these):**
- **Salesman edit-window predicate must include `pending_approval`.** Live `update_order_items` computes `v_editable := v_order.status = 'submitted' AND editable_until > now()`. But Commit-2 requires a `pending_approval` order to stay salesman-editable within the 2h window ("approval beats it"), so the predicate must become `status IN ('submitted','pending_approval')` — else an LG salesman can't edit their own just-submitted order. (Approved must stay non-editable → `status='approved'` already locks out.)
- **`cancel_order` must accept `pending_approval` + `approved`** to realize "reject = cancel-with-reason" and the guard's new `→cancelled` edges. The prompt adds the guard edges but doesn't mention updating the cancel RPC's status acceptance — verify it permits cancelling those states.

**Invariants I'll verify by execution at Commit 1 (the two that matter most):**
1. **Fixed-brand untamperability** — submit a Zebronics/Luminous order with a bogus client-sent price → the RPC must ignore it and snapshot the catalog price. A leak here lets a salesman set fixed-brand prices.
2. **D2 preserved on the RLS relax** — after the qual change, unpriced *fixed*-brand products stay hidden to salesmen; only unpriced *manual*-brand products become visible.

**Domain / correctness checks:**
- **State machine** ✓ — pending_approval/approved with guarded edges; approval beats the timer; admin-only →approved at RPC + guard.
- **Money** ✓ — ≤2-dec→paise; manual price validated `>0` + ceiling, no floor; fixed untamperable.
- **RLS** ✓ — relax scoped to manual brands; D2 kept for fixed (verify at c1).
- **Immutable snapshots** ✓ — manual price snapshotted into `order_items.unit_price_paise` at submit, enterer recorded in the event.
- **Backward-compat** ✓ — optional price key; no-price clients (deployed main, Zebronics/Luminous) unchanged.

**What I tried:** `git show dc04359` (1 prompt file, +67); live `execute_sql` — `orders_status_check` (exact 3-value), absence of the 4 new columns, `products_select_salesman` qual (exact), process_order/guard exist + approve_order absent, brands = ZEB+LUM (both fixed); pulled `guard_order_transition` def (edges: submitted→processed/cancelled, processed→cancelled).

**Open flags (cumulative):** No 🔴 blocking. No new ledger flag (prompt accurate). Carried 🟡 ㉝ (migration reconciliation — Phase-3b's `_lg_manual_approval.sql` will join the set), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Watch (Commit 1, not yet flags): editability predicate must include `pending_approval`; cancel_order must accept `pending_approval`/`approved`; verify fixed-brand untamperability + D2-preserved RLS by execution.

**Next-commit suggestion:** Commit 1 (backend). I'll verify by execution: LG order → `pending_approval`, client price snapshotted + enterer logged; `approve_order` admin-only (accountant denied at RPC + guard); `process_order` accepts `approved`, rejects `pending_approval`; **Zebronics/Luminous submit unchanged + client price ignored (untamperable)**; unpriced LG visible, unpriced fixed hidden; ㉘/㉞ preserved in `update_order_items`; build clean.

---

## Review of c895706 — prompt(phase3b): fold Quick Order collapse revamp into the salesman commit

**Verdict:** ✅ accept — a clean, accurate prompt amendment: folds the collapse-to-reveal row revamp into Commit 2 (both rewrite the same Quick Order rows — sound rationale), the salvage refs resolve, and it correctly preserves the existing stepper/keypad/brand-grouping. Docs/prompt only.

**Phase / commit goal (as I understood it):** Bundle the salesman "collapse-to-reveal" row revamp (rows collapse to name+price; tap reveals the same stepper + the LG price input inside the drop) into Phase-3b Commit 2, since both rewrite the same QuickOrder product rows — one row-rewrite rather than two.

**What works (verified):**
- **Salvage refs resolve** — `874f090` ("collapse Quick Order rows to name+price; tap to reveal stepper") + `fecc555` ("swap the two-glyph hint for one CSS chevron that rotates") exist on branch `test/salesman-ui-collapse`; the prompt's descriptions match, and it correctly flags them "pre-3a stale — re-implement fresh" (Phase-3a rewrote QuickOrder's grouping/lock, so the old spike wouldn't merge).
- **Preserves the right pieces** — the current row (`renderCategory` → `productRow` + `<Stepper onChange onTapQuantity>` + keypad + `brandGroups`/`categoryHeader` sticky) is exactly what the revamp rewrites; "the stepper is NOT replaced — it lives inside the drop," "in-cart rows pre-expanded (seed the Set once)," "per-row Set, not accordion," "≥48px tap targets / sticky headers + cart bar unchanged" all reference real current structure (QuickOrder.tsx L157–177). Consistent with the Phase-3a QuickOrder I reviewed (c2).
- **Money rule intact** — the manual-price input keeps ≤2-dec→paise, `>0`; fixed brands: catalog price, no input.

**Blocking issues (must fix in next commit):** None (docs/prompt).

**Non-blocking suggestions:**
- **Scope note for Commit 2:** the collapse revamp rewrites **all** salesman rows (fixed + manual), so it changes the deployed **Zebronics/Luminous** salesman UX too (rows now collapse; in-cart pre-expanded; catalog price on the collapsed head). Intended (general UX revamp, not LG-only), but it makes Commit 2 a substantial change to the daily-driver S4 screen — I'll verify the **fixed-brand path stays fully intact** (collapse/expand, stepper-in-drop, keypad, cart total, brand lock) on a phone-width viewport alongside the LG manual-price additions.

**Domain / correctness checks:** N/A — prompt/doc text; the money/RLS/state surface is unchanged from dc04359. The revamp is presentational (row shape); the manual-price input is already covered by the dc04359 checks.

**What I tried:** `git show c895706` (1 prompt file); `git rev-parse` confirmed `874f090`/`fecc555` + branch `test/salesman-ui-collapse` exist with matching subjects; grepped QuickOrder.tsx for the Stepper/keypad/brand-grouping the revamp must preserve (all present, `renderCategory`/`productRow`/`<Stepper>` at L157–177).

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉝ (migration reconciliation — Phase-3b `_lg_manual_approval.sql` will join), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Commit-2 watch-items: fixed-brand collapse path intact + the dc04359 items (pending_approval editability, manual-price ≤2-dec, untamperability).

**Next-commit suggestion:** Phase-3b Commit 1 (backend) — verification plan in the dc04359 block. Commit 2 then carries the collapse revamp + manual price.

---

## Review of 7bf7679 — feat(orders): phase3b c1 — manual-pricing brands + admin approval states (backend)

**Verdict:** ✅ accept — the Phase-3b backend, **thoroughly correct and proven by execution end-to-end**: fixed-brand price untamperability holds (a bogus client price on a Zebronics order stored the catalog ₹523, ignored the client), the LG manual/approval lifecycle works (pending_approval → admin-only approve → process; process-pending rejected; guard blocks non-admin →approved), the RLS relax preserves D2 (unpriced manual visible, unpriced fixed hidden), and **both my dc04359 watch-items were addressed** (pending_approval is salesman-editable in-window; accountant cancel-with-reason works). ㉘/㉞ preserved. **No test-brand pollution left** (rolled-back probes; catalog clean). tsc clean.

**Phase / commit goal (as I understood it):** Phase-3b Commit 1 — additive backend: brand pricing_mode/requires_approval flags, pending_approval/approved states, manual per-line pricing (client price for manual brands, untamperable catalog for fixed), approve_order (admin-only), process_order gating, guard edges, manual-product RLS relax.

**What works (verified live by execution — rolled-back probes, no data left):**
- **Fixed-brand untamperability (the security crux)** — Zebronics order carrying a bogus client `unit_price_paise: 1` → stored **52300** (catalog ₹523), `client_ignored=true`, `submitted`. The fixed branch does `v_unit_price := v_product.price_paise` and never reads the client price. A salesman cannot tamper Zebronics/Luminous prices.
- **LG manual lifecycle** — temp `manual`+`requires_approval` brand: salesman submit `₹45,000` → `pending_approval`, stored `4500000`, total `9000000`; `approve_order` **accountant→denied**, **admin→approved** (`approved_by` stamped); `process_order` approved→`processed`, pending→**rejected**; direct non-admin `UPDATE→approved`→**guard-rejected**.
- **Both dc04359 watch-items addressed** — (1) `update_order_items` `v_editable := status IN ('submitted','pending_approval') AND editable_until>now()`; a salesman editing a pending order in-window **succeeded** (qty/price corrected, stays pending). (2) `cancel_order`'s accountant/admin path has no status gate → an accountant **cancelled a pending_approval order with a reason** (guard allows `pending_approval→cancelled`) — the reject-with-reason flow.
- **RLS D2 preserved** — as salesman, unpriced **manual** product **visible** (`t`), unpriced **fixed** product **hidden** (`f`). Relax widens only manual brands.
- **㉘/㉞ intact** — `update_order_items` keeps the 4-arg `p_reason` after-lock guard + `tally_name` audit snapshots + brand guard (read + exercised via the edit probe).
- **Backward-compat + hygiene** — signature-stable RPCs (fixed clients that omit the price key behave as before; the untamper probe used a stray key, ignored); additive migration (both existing brands default `fixed`/no-approval); CHECK widened to 5; approve_order added. **No test data left** (brands still ZEB+LUM, `manual_products=0`, `zz%=0`, `orders=0`). tsc clean.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Salesman self-cancel asymmetry:** a salesman can *edit* their own `pending_approval` order in-window but can't *cancel* it (`cancel_order`'s salesman path still requires `status='submitted'` → "ask an accountant"). Not wrong (an LG order awaiting approval is arguably the office's to void), but if you want symmetry with the edit capability, widen the salesman cancel predicate to include `pending_approval`. Owner's call.
- The `submitted` event's `manual_priced:true` flag + `actor_id` records who priced at the order level; if you ever want per-line "who priced what," that's a richer payload — fine as-is.

**Domain / correctness checks:**
- **State machine** ✓ — pending_approval/approved added; guard enforces legal edges + admin-only →approved (proven); approval beats the timer.
- **Money** ✓ — manual price `>0` + ≤₹10L ceiling, no floor; integer paise; fixed untamperable (proven); totals correct.
- **RLS** ✓ — relax scoped to manual; D2 kept for fixed (proven).
- **Immutable snapshots** ✓ — price snapshotted at submit (catalog for fixed, entered for manual); fixed survivors keep the immutable price on edit (qty/position only).
- **Backward-compat** ✓ — deployed fixed-brand `main` unaffected.

**What I tried:** `git show 7bf7679` (migration + types); read the full migration; live state (CHECK widened, both brands fixed, approve_order + relaxed qual present); **three rolled-back execution probes** — (1) fixed untamperability, (2) full LG lifecycle, (3) pending editability + accountant cancel-reject + RLS D2; `cancel_order` def (accountant path unrestricted); post-hygiene (no leaked brands/products/orders); `tsc --noEmit` clean.

**Open flags (cumulative):** No 🔴 blocking. No new ledger flag. Carried 🟡 ㉝ (migration reconciliation — `_lg_manual_approval.sql` joins the set), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 2 (Quick Order collapse revamp + manual-price entry). I'll verify the fixed-brand collapse path stays intact + the LG manual-price input (≤2-dec→paise, in-drop) on a phone-width viewport, plus the pending_approval/approved salesman detail states.

---

## Review of f997e7b — prompt(phase3b): move the new status chips to commit 2 (shared getOrderStatusTag)

**Verdict:** ✅ accept — accurate prompt reorganization: `getOrderStatusTag` is a real shared helper, and moving the `pending_approval`/`approved` chip definitions into commit 2 correctly surfaces the new states on the salesman's own views (S2 Home, S7 detail) at submit — not just the accountant's dashboard in commit 3. Docs/prompt only.

**Phase / commit goal (as I understood it):** Move the `pending_approval` (amber) + `approved` (ink) chip definitions from c3 to c2, updating the shared `getOrderStatusTag` (`src/lib/order-status.ts`) so the salesman sees "pending approval" on their own LG order the moment they submit; c3 reuses the chips + adds the Pending-approval filter tab.

**What works (verified):**
- **`getOrderStatusTag` is the shared chip helper** — `src/lib/order-status.ts` exports it (committed at HEAD via 32c1c96) and it's imported by **S2 salesman Home** (`src/app/page.tsx`), the **S8 dashboard** (`OrdersList.tsx`), and **S7 order detail** (`orders/[id]/page.tsx` + workbench). A single update propagates to all three surfaces — the prompt's rationale holds.
- **Rationale UX-correct** — the salesman must see their LG order's `pending_approval` at submit, which only happens if the shared chip is updated in the salesman commit (c2), not deferred to c3. Sound.
- **c3 stays consistent** — the amendment correctly changes c3 to "reuse the chips from c2, don't redefine."

**Blocking issues (must fix in next commit):** None (docs/prompt).

**Non-blocking suggestions:** None. I'll verify the actual chip tones (amber pending / ink approved / green processed) when Commit 2 lands — the builder is already mid-drafting it in the working tree (uncommitted `order-status.ts` chips + `NewOrderFlow`/`cart`/`order-rpcs`).

**Domain / correctness checks:** N/A — prompt text; state/money/RLS surface unchanged.

**What I tried:** `git show f997e7b` (1 prompt file); confirmed `src/lib/order-status.ts` exports `getOrderStatusTag`, imported by S2 `page.tsx` / S8 `OrdersList.tsx` / S7 `orders/[id]/page.tsx` + workbench (the three surfaces the shared chip must reach); noted the chip additions are currently uncommitted (c2 in progress).

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (Builder mid-drafting Commit 2 in the working tree.)

**Next-commit suggestion:** Phase-3b Commit 2 (Quick Order collapse revamp + manual-price entry + shared chips) — verify chip tones, fixed-brand collapse path intact, LG manual-price input, and the salesman seeing `pending_approval` on their own order, on a phone-width viewport.

---

## Review of 1965c7a — feat(new-order): phase3b c2 — Quick Order collapse-to-reveal + manual (LG) price entry

**Verdict:** ⚠️ accept-with-followups — the code is correct and complete (collapse-to-reveal rows, manual-price entry, null-price handling, the cart→submit price plumbing, and the shared chips all verified; build/eslint/tsc clean). But the builder again **provisioned a brand on the shared prod DB for testing** — a live **LG** brand + 4 AC/fridge products, now salesman-visible (c1's RLS relax shows unpriced manual products) and flipping multiBrand to 3. Unlike CK, **LG is plausibly real** (it's the brand Phase-3b exists for; the products are realistic) — so this is an **owner-confirm** (🟡 ㊳), not a hard reject: keep it (real LG onboarding) or remove it (test data — safe, 0 orders ref).

**Phase / commit goal (as I understood it):** Phase-3b Commit 2 — rework the salesman Quick Order rows to collapse-to-reveal (name+price → tap reveals the unchanged stepper inside a drop), add the LG manual unit-price input, surface pending_approval/approved via the shared chips, thread entered prices cart→submit. Composes with Phase-3a grouping/lock.

**What works (verified — build/eslint/tsc clean):**
- **Collapse-to-reveal** — per-row `expandedIds: Set` (not accordion; multiple open), **seeded once** from in-cart lines (lazy initializer). Head is a `≥48px <button>` (name + price + "· N in cart"), `aria-expanded`; the drop holds the **unchanged `<Stepper>`** + keypad tap + (manual only) the price input; CSS chevron rotates. Applies to all brands.
- **Manual price + null-safety** — the price input renders only for `pricing_mode==='manual'` via `parsePricePaise` (≤2-dec→paise, inline error) with a local text buffer; collapsed head shows the entered price or **"Tap to price"**. Crucially `pricesById` only maps **non-null** catalog prices then layers `{...snapshotPrices, ...prices}`, so `formatRupees` never sees a manual `null` (`renderProduct` also guards `?? 0`). Same null-safe `pricesById` in Review.
- **Fixed-brand path intact** — no price input for fixed brands; catalog price on the head; collapse/stepper/keypad unchanged. `ProductOption.price_paise` now `number | null` + `pricing_mode` threaded (`page.tsx`).
- **Price plumbing = the c1 contract** — `toItemsPayload(items, prices)` sends `unit_price_paise` **only** when a price exists (manual); fixed lines send `{product_id, qty}`. `CHANGE_PRICE` reducer sets on `>0`, deletes on `≤0`. Prices thread submit/update + **offline-pending** payload + Review + resume-draft totals. In **edit mode** `cart.prices` is seeded from `snapshotPrices` for all lines, but a fixed line's sent price is **ignored by c1** (untamperable — proven at 7bf7679) and the UI exposes no fixed price input, so no tampering path.
- **Chips (shared `getOrderStatusTag`)** — `pending_approval` → **amber** "Pending approval · {countdown}" (still editable in-window; chip is status, not permission); `approved` → **`locked`/ink** "Approved" (deliberately not the green of Processed). One shared helper → S2 Home + S7 detail + S8 dashboard (per f997e7b).

**Followups (🟡 ㊳ + non-blocking):**
- **🟡 ㊳ — LG brand live on the shared prod DB (owner-confirm).** Commit note: "Temp LG brand provisioned … for live UI testing." Catalog now has **LG (manual, requires_approval) + 4 products** (LG 1.5-Ton AC, 2-Ton Split AC, 260L/340L fridges — all null-price), **salesman-visible** (RLS relax), multiBrand=3 on the deployed app. **Owner: intentional LG onboarding (keep) or test data (remove)?** Safe to delete (0 orders/order_items ref). **Second** brand provisioned on prod for testing (CK→㊲, now LG) — recommend a Supabase dev branch / owner sign-off to avoid deployed exposure.
- **Unpriced manual line (non-blocking UX):** a salesman can add an LG line (qty) without pricing it — the cart total counts it as ₹0 and Submit fails **server-side** ("invalid manual price") rather than being blocked up front. No corruption; consider pre-validating (flag the "Tap to price" line / block Review-submit).
- **Residual:** collapse/chevron/sticky visuals + tap targets need a **real-device** pass (logic + build verified; can't render headlessly).

**Domain / correctness checks:**
- **Money** ✓ — `parsePricePaise` (≤2-dec→paise) for manual; integer paise throughout; fixed untamperable (c1); totals via `pricesById` layering.
- **Immutable snapshots** ✓ — manual price → `order_items.unit_price_paise` at submit; fixed survivors keep catalog snapshot on edit.
- **State machine / chips** ✓ — pending/approved surfaced; pending stays salesman-editable in-window.
- **RLS** ✓ — unchanged here (the relax is c1's; D2 preserved, verified there).
- **㉕** ✓ — the unavailable-line handling preserved in the row rewrite.

**What I tried:** `git show 1965c7a` (11 files); read QuickOrder (collapse/manual/null-handling), order-rpcs (payload), NewOrderFlow (CHANGE_PRICE + submit/offline threading), Review, order-status (chips), page (nullable price); `npm run build` exit 0 + `eslint` clean on all changed files; live catalog check → **LG brand + 4 realistic AC/fridge products** (null-price, salesman-visible, 0 orders ref).

**Open flags (cumulative):** **🟡 ㊳ NEW — LG brand + 4 products live on the shared prod DB (owner-confirm: real onboarding vs test; salesman-visible + deployed). Recurring provision-on-prod pattern (2nd after ㊲).** No 🔴 blocking. Carried 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Commit 3 (dashboard Pending-approval tab + admin Approve). I'll verify the tab folds into the scoped counts, the Approve button is admin-only (hidden for accountant + RPC/guard deny — proven at c1), and Mark-processed stays blocked until approved. Also resolve 🟡 ㊳ (LG disposition).

---

## Review of fa77bd5 — feat(dashboard): phase3b c3 — Pending approval tab + admin Approve action

**Verdict:** ✅ accept — the Phase-3b dashboard, clean and correct: a Pending-approval tab that folds into the two-stage scoped counts, an **admin-only Approve** action (triple-enforced: UI-hidden for the accountant + c1's `approve_order` role check + the guard trigger — server-side denial proven live at c1), Mark-processed correctly gated to submitted/approved (hidden for pending), and the workbench editable window extended to `pending_approval` to match the RPC. tsc/eslint/build clean.

**Phase / commit goal (as I understood it):** Phase-3b Commit 3 — S8 Pending-approval filter tab (into the scoped counts, reusing the c2 chips); S9 workbench Approve (admin-only) + processed-gating + approved byline/event.

**What works (verified):**
- **Pending-approval tab folds into the scoped counts** — `StatusFilter` gains `pending_approval`; `tabCounts.pending_approval = scoped.filter(status==='pending_approval')` (composes with the salesman/brand/range/search scope like the other tabs); the tab strip includes it between Submitted and Processed. A new `STATUS_LABEL` map renders "**Pending approval**" correctly (the old inline `s[0].toUpperCase()+s.slice(1)` would've shown "Pending_approval" — good refactor). Chips come from the shared `getOrderStatusTag` (c2), not redefined — matches f997e7b.
- **Admin-only Approve (security-critical, triple-enforced)** — `{status === 'pending_approval' && isAdmin && <Approve>}`: the accountant sees a pending order but **no Approve button**; `approveOrder` → `approve_order` RPC (`v_role='admin'`) + the `guard_order_transition` trigger both deny non-admins — **I proved the server-side denial live at c1** (accountant approve → denied; non-admin →approved → guard-rejected). UI gate backed by two server guards.
- **Mark-processed gating** — shows for `submitted` (fixed) or `approved` (manual); **hidden for `pending_approval`**. A pending LG order can't be processed until an admin approves it (c1's `process_order` also rejects a pending process). Correct lifecycle: pending → (admin) approve → processable.
- **Workbench editable window extended to pending_approval** — `editable = (status==='submitted' || status==='pending_approval') && editableUntil > now`, matching the RPC's `v_editable` (c1) so a staff in-window edit of a pending order needs no reason. Consistent with the c1 watch-item, now applied to the workbench too.
- **Approved byline + event + wrapper** — header shows "approved {time} by {name}" (page.tsx fetches `approved_at`/`approved_by`+name + caller `isAdmin`); the `approved` event renders in the history register (order-events.ts); `approveOrder` wrapper added (via `callRpc`, offline-aware). tsc guarantees page.tsx supplies the new `isAdmin`/`approvedAt`/`approvedByName` props.
- **Compiles** — `tsc --noEmit` + `eslint` clean; `npm run build` exit 0.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None material. (The 🟡 ㊳ LG-brand-on-prod question is from c2, still open — resolving it lets the Pending-approval tab be exercised with a real LG order on a device.)

**Domain / correctness checks:**
- **State machine / approval** ✓ — admin-only approve (UI + RPC + guard, server-proven at c1); process gated to submitted/approved; pending editable in-window.
- **RLS/auth** ✓ — Approve triple-enforced; no accountant path to approve.
- **Money / snapshots** — N/A (display + action wiring).
- **Filter/tab composition** ✓ — pending_approval count folds into the scoped two-stage counts.

**What I tried:** `git show fa77bd5` (5 files); read OrdersList (tab + STATUS_LABEL + scoped count), OrderWorkbench (admin-only Approve gate, processed gating, editable-window extension, approved byline), order-rpcs (approveOrder wrapper); `tsc --noEmit` + `eslint` clean; `npm run build` exit 0. (Server-side admin-only denial already proven live at c1 — not re-run.)

**Open flags (cumulative):** No 🔴 blocking. Carried 🟡 ㊳ (LG brand on prod — owner-confirm, from c2), 🟡 ㉝ (migration reconciliation), ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Phase-3b is functionally complete (c1 backend proven, c2 salesman UI, c3 dashboard). Remaining: resolve 🟡 ㊳ (LG disposition); a real-device pass of the collapse revamp + the LG approve flow end-to-end; the pre-M6 ㉝ migration dry-run (now 4 phase-3 migrations).

---

## Review of 670ad93 — chore(migrations): reconcile filenames with the schema_migrations ledger (㉝)

**Verdict:** ✅ accept — ㉝ resolved correctly and completely: all 22 migration files renamed so their 14-digit prefix **exactly matches** the recorded `schema_migrations.version`, pure renames (no SQL/content change), order preserved, doc/prompt refs updated, no stale T-format refs left. A future `supabase db push` now sees all 22 versions as already-applied → no re-apply/collision. File-only; nothing applied to the DB. *(Reviewed on `feature/phase3b-lg-manual-approval`; verified before this block could be committed the checkout switched to `main` — recorded now post-merge af20a5a.)*

**Phase / commit goal (as I understood it):** Fix ㉝ — the migration files used a non-standard `YYYYMMDDThhmmss` (T) prefix matching neither the CLI's 14-digit format nor the apply-time versions the DB recorded, so a real `supabase db push` would find zero matches and try to re-apply all 22 → collision. Rename each file's prefix to its recorded ledger version.

**What works (verified):**
- **1:1 filename↔version match** — I listed the 22 current migration prefixes and the 22 `schema_migrations.version` rows; they match **exactly**, same order (`…173452 profiles_and_helpers` … `…120241 lg_manual_approval`). `db push` keys on the numeric version prefix, so every local file now resolves to an already-applied version → skipped.
- **Pure renames** — all 22 are `R100` (100% similarity, 0 content change): no SQL/schema/behaviour change; the DB is untouched (the versions were already recorded).
- **Order preserved** — the new 14-digit prefixes sort in the identical dependency order as the old T-prefixes (e.g. `orders_cancelled_by …184517` still precedes `username_login …194648`, whose recorded apply-time was actually 07-06 despite the old `0707T090000` name). No migration reordered.
- **No stale references** — the 5 doc/prompt edits updated the filename refs (catalog-admin-m5.5 / phase3a / salesman-app / supabase-setup prompts + catalog-admin-design), and a repo grep finds **no** remaining T-format migration refs in `Prompts/`/`docs/` (comments.md's historical refs correctly left as-is). The setup prompt's T-example was fixed so the pattern isn't perpetuated.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- Cosmetic: file `20260707173831_fix_submit_order_minuuid.sql` vs the ledger's recorded name `fix_submit_order_brand_minuuid` — the **version** matches so `db push` is unaffected (it keys on the prefix); the descriptive suffix just differs. No action.
- Before the actual deploy/handover, run a real `supabase db push --dry-run` (or against a throwaway branch) to confirm the CLI agrees all 22 are applied — this rename makes that dry-run the final confirmation (I can't run it here — no CLI + it'd touch the project).

**Domain / correctness checks:** N/A for code — filename reconciliation. Migration integrity: content unchanged (R100), versions now match the applied ledger 1:1, no re-apply risk.

**What I tried:** `git show 670ad93` (22 R100 renames + 5 doc edits); queried `supabase_migrations.schema_migrations` (22 versions) + cross-checked each against the renamed files' prefixes → exact 1:1 match, same order; `ls` confirmed no T-format file remains (22 files); grep confirmed no stale T-format refs in prompts/docs.

**Open flags (cumulative):** **🟡 ㉝ ✅ CLOSED** at 670ad93 — filenames reconciled to the `schema_migrations` ledger (1:1, verified); a `db push --dry-run` before deploy is the final confirmation. No 🔴 blocking; only 🟡 ㉛ (order_no_seq — owner-deferred) + older doc flags ⑯ ⑬ ⑭ ⑦ ⑧ ⑨ remain.

**Next-commit suggestion:** e56b272 (pick-slip Share prompt) + af20a5a (phase3b→main merge) — reviewing next.

---

## Review of e56b272 — prompt: pick-slip mobile Share button (Web Share API)

**Verdict:** ✅ accept — accurate, well-scoped frontend-only prompt; the file/props/classes/helpers it targets all verify, and the Web Share API guidance is technically correct (SSR-safe feature-detect, swallow AbortError, text-not-link because auth-gated, secure-context caveat, respect the Prices toggle). Docs/prompt only.

**Phase / commit goal (as I understood it):** Add a Share button to the pick slip (S10) beside Print that opens the phone's native share sheet via `navigator.share`, sharing the order as formatted WhatsApp-friendly text (respecting the Prices on/off toggle).

**What works (verified):**
- **Target + structure accurate** — `PickSlip.tsx` exists, is `"use client"`, has the **Print** button in `.chromeControls` (screen-only `.chrome`, excluded from print) — so "add Share beside Print in `.chromeControls`" lands correctly; the `pricesOn` toggle (with the "ORDER COPY"/"PICK SLIP" badge) is real, so "respect the toggle" maps to existing state.
- **Helpers + props present** — `formatRupees` (format.ts:99) + `formatFullTimestamp` (format.ts:41) exist; the props the text-format references (orderRef, retailerName, salesmanName, items w/ unit_price_paise + line_total_paise, totalPaise, brandName, submittedAt, notes) are all on PickSlip. (Retailer area/phone are fetched at the page level; the prompt's bare `area`/`phone` pseudo-code maps to the actual `retailerArea`/`retailerPhone` props — trivial wiring.)
- **Web Share API guidance correct** — feature-detect **after mount** in `useEffect` (avoids the SSR `navigator`-undefined hydration mismatch); `navigator.share({ title, text })` with **no `url`** (right — the page is auth-gated, a link is useless to a non-user); **swallow `AbortError`** (user cancelled, not an error); the **secure-context** caveat (HTTPS/localhost only, not plain-HTTP LAN) is accurate + consistent with the prior `crypto.randomUUID` gotcha.

**Blocking issues (must fix in next commit):** None (docs/prompt).

**Non-blocking suggestions:**
- The Copy-to-clipboard fallback is left "optional" — fine (the target is the phone); desktop parity is the follow-up if wanted.
- Text-format pseudo-code uses bare `area`/`phone`; map to the real `retailerArea`/`retailerPhone`. Trivial.

**Domain / correctness checks:** N/A — prompt text; no data/RLS/state surface. Money: the shared text reuses `formatRupees` on the same paise fields the slip renders — consistent, display-only.

**What I tried:** `git show e56b272` (1 prompt file, +41); grepped `PickSlip.tsx` (`"use client"`, Print in `.chromeControls`, `.chrome` screen-only, `pricesOn`, referenced props) + `format.ts` (`formatRupees`/`formatFullTimestamp` present).

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (㉝ closed at 670ad93.) Residual: this is a **mobile** feature — `navigator.share` needs a real phone / deployed HTTPS URL to verify (can't test headlessly).

**Next-commit suggestion:** The pick-slip Share implementation — I'll verify the feature-detect gates the button (no SSR hydration issue), AbortError swallowed, shared text respects `pricesOn` + reuses `formatRupees`, Print/print-output unchanged, build clean; the actual share-sheet interaction needs a device.

---

## Review of af20a5a — merge: Phase 3b LG manual pricing + admin approval into main (c1–c3)

**Verdict:** ✅ accept (clean integration) — a conflict-free merge of the fully-reviewed Phase-3b branch into `main`: `git diff 670ad93 af20a5a -- src/ supabase/` is **empty** (main's code + migrations exactly match the reviewed phase3b tip), the only thing `main` (e56b272) contributed beyond the tip is the **reviewed** pick-slip Share prompt, no conflict markers, tsc clean, all my Phase-3b review blocks came across in comments.md. **No unreviewed code entered main.**

**Phase / commit goal (as I understood it):** Integrate `feature/phase3b-lg-manual-approval` (c1 backend + c2 salesman UI + c3 dashboard + prompt commits + the 670ad93 migration reconcile) into `main`.

**What works (verified):**
- **Clean union** — `git diff 670ad93 (phase3b tip) af20a5a -- src/ supabase/` = **empty** ⇒ main's application code + all 22 migrations are byte-identical to the reviewed tip; no merge-resolution drift. The merge's only delta over the tip is `Prompts/pickslip-share-button-builder-prompt.md` (e56b272, reviewed above).
- **No conflicts** — no `<<<<<<<`/`>>>>>>>` markers in src/supabase/comments.md.
- **Review log carried** — comments.md brought all Phase-3b review blocks (c1/c2/c3 + the prompt reviews); the branch's comments.md was a superset of main's, so it merged cleanly.
- **Compiles on main** — `tsc --noEmit` clean post-merge (c1–c3 already build-verified individually).
- **Backend already live** — the phase3b migrations were applied to the shared DB during the branch work (c1 proven by execution); the merge is code/log integration, no new DB action.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None. Unlike the phase3a merge (34d6231), no open blocker rode along — ㊳ was already closed (owner), ㉝ resolved at 670ad93.

**Domain / correctness checks:**
- **Merge integrity** ✓ — clean union, no unreviewed code, all 22 migrations present + reconciled (㉝).
- Money / RLS / state machine — unchanged (verified per phase3b commit; untamperability + admin-only approval proven live at c1).

**What I tried:** `git show af20a5a` (parents e56b272 + 670ad93); `git diff 670ad93 af20a5a -- src/ supabase/` (empty — clean union); `--stat` (only the pick-slip prompt beyond the tip); conflict-marker grep (none); confirmed the phase3b review blocks present in comments.md; `tsc --noEmit` clean.

**Open flags (cumulative):** No 🔴 blocking. **No open 🟡 needing action** — ㉝ ✅ (670ad93), ㊳ ✅ (owner), ㊱/㊲ ✅. Only 🟡 ㉛ (order_no_seq — owner-deferred to go-live) + older doc flags ⑯ ⑬ ⑭ ⑦ ⑧ ⑨ remain. **Phase-3b complete + merged to main.**

**Next-commit suggestion:** The pick-slip Share **implementation** (per e56b272) is the likely next code commit — verified on a device. Pre-handover: the `supabase db push --dry-run`, a real-device pass of the salesman flow + LG approve + share, and a catalog/orders cleanup to a real starting state.

---

## Review of 8e6b4c8 — feat(new-order): Quick Order search matches brand + category, not just name

**Verdict:** ✅ accept — a minimal, correct search-scope widening: the salesman search now matches product name OR category OR brand (all via the existing `normalize`); the brand lock/picked-brand filter still ANDs on top unchanged; null-safe. tsc/eslint clean. *(Branch `ui/salesman-search-brand-category`, off main@416be41.)*

**Phase / commit goal (as I understood it):** Broaden the Quick Order search so a category term ("adaptor", "refriger") or a brand term ("ze") surfaces the matching items, not just product-name matches.

**What works (verified):**
- **Predicate widened correctly** — `matchesSearch(p) = q==="" || normalize(p.name).includes(q) || normalize(p.category).includes(q) || normalize(p.brand_name).includes(q)`; `visible = products.filter(p => matchesSearch(p) && (effectiveBrand === null || p.brand_id === effectiveBrand))`. So text match is name/category/brand OR, and the brand filter (lock or picked) is still ANDed on top — brand scope unchanged, only the text match broadened.
- **Null-safe + consistent** — `p.category` is a required `string`; `p.brand_name` is `string` (`brands?.name ?? ""` from page.tsx), so `normalize` never sees null; same space-insensitive `normalize` as the name search ("ze"→"zebronics", "adaptor" matches "Adaptors").
- **Grouping/lock intact** — `brandGroups` still derives from `visible`, so Brand▸Category grouping + counts reflect the widened search; lazy brand-lock, `effectiveBrand`, and the collapse rows are untouched. Placeholder → "Search name, brand or category".
- **Compiles** — `tsc --noEmit` + `eslint` clean.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- OR semantics mean a brand term also surfaces *other-brand* products containing the term in name/category (e.g. "ze" matches any product with "ze" anywhere, not only Zebronics). Intended broad search — fine; the strict "only that brand" path is the brand *filter*/lock, not the text box. No change needed.

**Domain / correctness checks:** N/A — client-side display filter; no data/RLS/money/state surface (the RLS-scoped catalog is unchanged; this only narrows what's shown).

**What I tried:** `git show 8e6b4c8` (QuickOrder.tsx, +10/−4); traced `matchesSearch` + that `effectiveBrand` still ANDs on top; confirmed `category`/`brand_name` are non-null strings; `tsc --noEmit` + `eslint` clean.

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Nothing outstanding. A real-device pass would confirm the widened search feels right on a phone (pure filter change, low risk).

---

## Review of 54517c7 — fix(products): Active toggle flips instantly + supports concurrent rows (useOptimistic)

**Verdict:** ✅ accept — a clean fix for two real bugs in the M5.5 toggle: the single `busyId` behaved like a radio (a second row's tap cleared the first's busy), and the row didn't visually flip until `router.refresh()` landed (looked like nothing happened though the write succeeded). Now `useOptimistic` flips instantly + **auto-reverts on failure**, and a `busy` Set lets rows toggle concurrently. Render-from-prop (㉜🅐) preserved. tsc/eslint clean. *(Branch `feature/products-delete-and-toggle-fix`.)*

**Phase / commit goal (as I understood it):** Make the Products ledger ACTIVE toggle flip immediately on tap (optimistic) and support several rows in flight at once, instead of a single-select-radio busy id + a flip that only appeared after a refresh.

**What works (verified):**
- **useOptimistic overlay, correct** — `[displayProducts, applyOptimisticActive] = useOptimistic(products, (state, {id, active}) => state.map(patch))`; the table + mobile cards render from `displayProducts`; the optimistic patch is dispatched **inside** the transition, **before** the `await` (correct placement). Row flips instantly.
- **Auto-reverts on failure (elegant)** — on `updateError` it sets the error and does **NOT** call `router.refresh()`; when the transition ends, `useOptimistic` discards the patch and falls back to the unchanged `products` prop → the flip reverts. On success, `router.refresh()` brings the updated prop and the overlay reconciles to the (now-matching) server value. A stale optimistic flip can't mask real data — the ㉜🅐 render-from-prop guarantee holds (comment says so, and the mechanics back it).
- **Concurrent rows** — `busyId` (single) → `busy: Set`; several toggles in flight, each row `disabled={busy.has(p.id)}` independently; a same-row double-tap is blocked while its write is in flight. Fixes the radio-like behavior.
- **Derivations correct** — `priced` (L55) + `categoriesByBrand` (L61) stay on the **raw `products`** prop (both active-independent → no needless recompute on an optimistic flip); only `mobileGroups` (L74) + the table/cards render from `displayProducts`. Matches the commit's claim.
- **Compiles** — `tsc --noEmit` + `eslint` clean.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Device-check the success-path visual:** the failure path clearly reverts; on success the overlay resets when the transition ends and reconciles as `router.refresh()`'s data lands. If Next keeps the transition pending through the refresh (its documented behavior), the flip is clean; if the reset races ahead of the refetch there could be a brief revert-flicker (new→old→new). Worth an eyeball on a real browser — the whole point is the instant flip. (Not a correctness issue; the final state is always right.)

**Domain / correctness checks:**
- **render-from-prop (㉜🅐/🅑)** ✓ — `displayProducts` derives from the `products` prop via useOptimistic; a post-write refresh (or a modal edit changing active) flows through and the overlay reconciles; no stale masking.
- **RLS/write** ✓ — still `update({active}).eq(id)` via the browser session (`products_staff_update`, accountant+admin); unchanged.
- **Money / state machine** — N/A (active toggle).
- **Row-click edit** ✓ — the toggle still `stopPropagation`s so it doesn't open the edit modal.

**What I tried:** `git show 54517c7` (ProductsPricing.tsx, +33/−23); traced the useOptimistic dispatch (inside transition, pre-await), the failure-revert (no refresh → overlay discarded), the `busy` Set concurrency, and that `priced`/`categoriesByBrand` stay on raw `products` while renders use `displayProducts`; `tsc --noEmit` + `eslint` clean.

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The branch name (`feature/products-delete-and-toggle-fix`) hints a product **delete** is coming — I'll watch for FK safety (`order_items` reference products; a delete must be blocked or soft where an order references the product) + admin-only. Plus a device-check of the toggle flip.

---

## Review of 81b7547 — feat(products): admin hard-delete in Edit modal, guarded against ordered products

**Verdict:** ✅ accept — a safe, well-guarded destructive feature, **proven by execution**: `delete_product` is admin-only (accountant denied, live), refuses any product referenced by an order line (order history protected, live), and deletes a never-ordered product cleanly (live) — all backstopped by the `order_items` FK being **NO ACTION** (never cascades) and no DELETE RLS policy (the RPC is the only delete path). Two-step Delete→Confirm, admin+edit-only, error surfaced. tsc/eslint/build clean.

**Phase / commit goal (as I understood it):** Let an admin hard-delete a mistaken/test product from the Edit modal (freeing its `(brand_id, tally_name)` for re-add), guarded so it can never orphan order history.

**What works (verified by execution — rolled-back probes):**
- **Admin-only (server-enforced)** — `delete_product` raises `only admin may delete products` for non-admins; proven live: an **accountant** call was **denied**. And there's **no DELETE RLS policy** on products, so a direct client `delete` is default-denied — the security-definer RPC is the sole path (no bypass).
- **Order-history protected** — the RPC refuses if any `order_items.product_id = p_id` ("deactivate it instead"); proven live: I created a temp order referencing a product, then an **admin** `delete_product` on it → **refused**. Backstop: `order_items_product_id_fkey` is **NO ACTION** (not CASCADE) — even if the check were bypassed the delete is FK-blocked, and a delete can **never** cascade-destroy order_items (immutable snapshots safe); the FK also serializes the check-then-delete race vs a concurrent order insert.
- **Clean delete of a never-ordered product** — proven live: an admin `delete_product` on an unreferenced product removed the row (`gone=true`), then rolled back (products count unchanged, no probe junk, orders still 0).
- **UI correct** — the Delete button is `mode==="edit" && isAdmin && initial` (admin + edit-only), **two-step** (`destructive` "Delete" → `destructive-filled` "Confirm delete") so a red button beside Cancel can't be a one-tap accident; the RPC refusal message surfaces in the modal error strip; both Button variants exist. Types regenerated (tsc clean).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None. (A hard delete frees `(brand_id, tally_name)` so the same item can be re-added — a real benefit over deactivate for typos/test rows; deactivate remains the path for ever-ordered products, which the refusal message points to.)

**Domain / correctness checks:**
- **Immutable snapshots** ✓ — FK NO ACTION + the order-reference refusal mean a product with order history can never be deleted, and order_items are never cascade-removed. Order history inviolable.
- **RLS/auth** ✓ — admin-only at the RPC (proven, accountant denied); no DELETE policy → RPC-only.
- **Money / state machine** — N/A.
- **Data safety** ✓ — destructive but bounded to never-ordered products; two-step UI; no cascade.

**What I tried:** `git show 81b7547` (delete_product migration + ProductModal diff + types); live checks — `order_items→products` FK is NO ACTION, no products DELETE policy, `delete_product` exists; **rolled-back execution probe** — accountant delete **denied**, admin delete of an ordered product (temp order created) **refused**, admin delete of a never-ordered product **succeeded** then rolled back (post-check: orders 0, no probe junk); `tsc --noEmit` + `eslint` clean; `destructive`/`destructive-filled` Button variants confirmed present.

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (New migration `20260708144837_delete_product.sql` is already 14-digit — slots cleanly into the ㉝-reconciled ledger.)

**Next-commit suggestion:** Nothing outstanding on `feature/products-delete-and-toggle-fix` (useOptimistic toggle + this delete — both verified). Ready to merge to main when you are; a device-check of the toggle flip + delete confirm is the only real-browser follow-up.

---

## Review of 2f9809d — fix(nav): add hover state to desktop sidebar links

**Verdict:** ✅ accept — trivial, correct cosmetic CSS: a `:hover` (ink text + subtle wash) + `cursor: pointer` + 0.12s transition on `.railLink`, placed before `.railLink.active` so the current page keeps its accent while hovered. Presentational-only; no logic/data surface. *(On `main`; history is linear — the search/toggle/delete branches fast-forwarded in, all reviews present.)*

**Phase / commit goal (as I understood it):** Give the desktop sidebar rail links hover feedback (they had an active style but no `:hover`).

**What works (verified):**
- **Correct + minimal** — adds `cursor: pointer` + `transition: background 0.12s, color 0.12s` to `.railLink` and `.railLink:hover { color: var(--color-ink); background: rgba(20,24,31,0.05) }`. Standard hover pattern.
- **Cascade correct** — `.railLink:hover` and `.railLink.active` are equal specificity (0,2,0), so source order decides; `:hover` is placed **before** `.active`, so an active link being hovered keeps its accent color/border (active wins) while still getting the hover wash. Matches the commit's stated intent.
- **Scope** — one file (`DashboardNav.module.css`, +7), CSS-only; no JS/type/data change (no build/tsc concern).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None. Visual is browser-verifiable, but the CSS is manifestly correct.

**Domain / correctness checks:** N/A — presentational CSS; no data/RLS/money/state surface.

**What I tried:** `git show 2f9809d` (1 CSS file, +7); confirmed CSS-only, standard hover, and the specificity/source-order reasoning (`:hover` before `.active` → active accent preserved on hover).

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Nothing outstanding.

---

## Review of e49fd07 — feat(new-order): Quick Order polish — unified price line, tighter price input, per-brand model prefix

**Verdict:** ✅ accept — three Quick Order refinements, all **verified live**: the new `brands.show_model` flag is correctly decoupled from `pricing_mode` (proven necessary against real data), the model-prefix render is guarded against `X・X`, and the price-prompt/input CSS changes are sound. Migration applied + on disk + in the ㉝-reconciled ledger. tsc/eslint/build clean.

**Phase / commit goal (as I understood it):** Polish the salesman collapse rows — (1) render "Tap to price" with the same class as a real ₹ price (drop the accent prompt), (2) tighten the expanded price input to the 48px touch floor, (3) add a per-brand `show_model` flag that renders `{tally_name}・{name}` for LG.

**What works (verified by execution):**
- **`show_model` decoupling is correct — and proven so.** Live: LG `show_model=true` / LUM,ZEB `false`. The commit claims a naive "tally≠name" rule would wrongly light up Luminous — **confirmed against the real catalog**: LG 526/526 rows have `tally_name≠name`, **Luminous has 36** such rows, Zebronics 0. So a `tally≠name` heuristic *would* have shown the model on 36 Luminous rows; the explicit per-brand flag is the right call, not over-engineering.
- **Render guard prevents `X・X`** — `p.show_model && p.tally_name && p.tally_name !== p.name` (QuickOrder.tsx:199); a defaulted `tally_name===name` row falls through to plain `{p.name}`. The muted `.modelPrefix` (`--color-locked`, weight 400) keeps the human name primary.
- **Price-label logic intact** (QuickOrder.tsx:179–183) — manual+entered → `formatRupees`, manual+unpriced → "Tap to price", fixed → `formatRupees`. The CSS change only drops the accent/semibold `.productPricePrompt`, so an unpriced LG line and a priced Luminous line read identically on the price line, exactly as claimed.
- **CSS floor respected** — `.priceField min-height 44→48px` (raised to the touch floor, not below), input width `92→68px`, tighter gaps. Stepper untouched.
- **Query/types wired** — page.tsx selects `tally_name` + `brands(... show_model)`, maps with null-safe `?? false`/`?? ""`; `database.types.ts` gains `show_model` on brands Row/Insert/Update. Build compiles the `/new-order` route.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None.

**Domain / correctness checks:**
- **Migration ledger (㉝)** ✓ — `20260708172917_brand_show_model` is applied in `schema_migrations`, present on disk with matching version+name; `not null default false` then `update ... where code='LG'`. Slots cleanly into the reconciled ledger.
- **Money** — N/A (display-only; price-label formatting unchanged).
- **RLS** — read path only; unchanged product select.

**What I tried:** `git show e49fd07`; live SQL (rolled-back/read-only) — per-brand `show_model` + `tally_name≠name` counts (LG 526/526, LUM 36/99, ZEB 0/44); `schema_migrations` vs `ls supabase/migrations`; read QuickOrder.tsx render guard + `priceLabel`; `npm run build` exit 0 (`/new-order` compiled).

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛ (order_no_seq — owner-deferred), ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** User-management docs landed next (68ac748) → reviewed below.

---

## Review of 68ac748 — docs(users): SQL-based add-user runbook + admin user-mgmt builder prompt

**Verdict:** ✅ accept — docs-only; the runbook rewrite matches the *actual* Supabase dashboard flow (create-then-SQL, no-email pgcrypto reset) and the builder prompt is a faithful, security-forward spec for the screen that lands in 7a46fa4/28a59e3.

**Phase / commit goal (as I understood it):** Correct `docs/add-user-runbook.md` to the real dashboard (drop the flaky "User Metadata"/email-reset steps, add create→SQL for username/full_name/role and a pgcrypto direct password reset), and add `Prompts/admin-user-management-builder-prompt.md` specifying the in-app admin Users screen.

**What works:**
- **Runbook is now accurate** — the app reads `profiles.full_name`/`username`, not Supabase Auth "Display name"/metadata; the doc says exactly that and sets the app fields via SQL joined through `auth.users.email`. The `email_for_username()` verify step is the right smoke test (NULL ⇒ won't log in).
- **No-email password reset** via `extensions.crypt(pw, gen_salt('bf'))` writing `encrypted_password` — the correct `$2a$` bcrypt shape GoTrue accepts; sensible for placeholder gmails with no real inbox.
- **Builder prompt is security-first** — mandates the double gate (page + every action), service-client-only, self-lockout + last-admin guards, type-password-twice, no schema change. The implementation commits honor it (verified below).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** The pgcrypto reset is a *fallback* SQL path; once the in-app screen shipped (28a59e3 adds the "primary path" note), it's belt-and-suspenders. No action.

**Domain / correctness checks:** N/A — documentation. Claims cross-checked against the schema (`profiles` columns, `create_profile_for_new_user` trigger behavior) and the shipped feature.

**What I tried:** `git show 68ac748` (runbook diff + new prompt); cross-read against the actual `profiles` schema and the implemented actions/page.

**Open flags (cumulative):** No 🔴 blocking, no new flag. Carried 🟡 ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The gated Server Actions (7a46fa4) → reviewed below, with the full accountant-as-attacker security pass.

---

## Review of 7a46fa4 — feat(users): gated admin Server Actions for user management (no UI yet)

**Verdict:** ✅ accept — the security-critical layer, **proven fail-closed by execution**. Every action calls `requireAdmin()` (server-side, from the session cookie, via `getUser()`) *before* any service client is constructed; a non-admin caller is rejected with zero mutations, and the RLS backstop independently blocks a non-admin who bypasses the app entirely. Self-lockout + last-admin guards verified against real data. Two minor non-blocking flags (TOCTOU race; partial-create), neither a security hole.

**Phase / commit goal (as I understood it):** Establish the app's first real gated Server Actions — `createUser`, `updateUserProfile`, `resetUserPassword`, `setUserActive` — each running on the privileged `server-only` service client but guarded by an admin re-check derived from the session, plus validation, self-lockout, and last-admin guards.

**What works (verified by execution — live rolled-back RLS impersonation):**
- **The gate reads the caller's TRUE role and fails closed.** `requireAdmin()` uses the RLS server client's `getUser()` (revalidated against the Auth server, not `getSession()`), reads `role,active` for `auth.uid()`, and throws `Forbidden` unless `active && role==='admin'`. Simulated as the RLS `authenticated` role under each user's real JWT: **admin gate_passes=true (positive control); accountant=false; salesman=false.** Because it `throw`s (never returns) and runs before `createServiceClient()`, a rejected caller triggers zero privileged work.
- **RLS backstop (defense-in-depth) holds if the app is bypassed.** The actions use the service client (bypasses RLS), so `requireAdmin()` is the app-layer gate — but I confirmed that a non-admin hitting PostgREST *directly* with their own JWT still can't escalate: accountant self-`update role='admin'` → **0 rows** (`profiles_update_admin` qual requires admin; accountant has no self-update path), salesman self-escalate → hard **`42501` RLS rejection** (`profiles_update_self` with_check pins `role`/`active` to current values). So neither the app gate nor the DB can be individually defeated.
- **Self-lockout + last-admin guards** — `updateUserProfile`/`setUserActive` reject self-demote/self-deactivate (`targetId===callerId`), and `wouldOrphanAdmins()` counts active admins (incl. target) and blocks any demote/deactivate leaving ≤1. Verified against live data: exactly **1 active admin** (vikram) ⇒ demoting/deactivating him is blocked (`≤1 → true`).
- **Validation** — email/username(`^[a-zA-Z0-9_.]{3,20}$`)/role/full_name/password≥8 all checked server-side; friendly dup-username pre-check *and* the citext-unique violation both mapped to "already taken"; GoTrue duplicate-email mapped to a friendly message. Passwords never logged/echoed.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **㊴ `wouldOrphanAdmins` is a non-atomic count-then-update (TOCTOU).** Two concurrent demotions of two *different* admins could each read count=2 and both proceed → 0 active admins. Real but very low severity at this scale (1–2 staff); a single-statement guarded UPDATE (or a `SELECT ... FOR UPDATE`/advisory lock) would close it. Not blocking.
- **createUser partial failure** — if `admin.createUser` succeeds but the follow-up `profiles.update` fails (e.g. a username race), the auth user exists as an inert salesman with `username=NULL` (can't username-login), fixable via Edit. The code comments acknowledge this and the guardrail (never delete) is honored; acceptable.

**Domain / correctness checks:**
- **Auth/authorization** ✓ — `getUser()` (not `getSession()`); gate before service client; throws not returns; server-derived caller id (never client-passed).
- **Privilege isolation** ✓ — service client constructed only past the gate; `server-only` (verified in 28a59e3).
- **Money / state machine** — N/A.

**What I tried:** Read `actions.ts` end-to-end; live rolled-back RLS impersonation (`set local role authenticated` + `request.jwt.claims`) of admin/accountant/salesman running the exact gate select + direct self-escalation attempts; live `wouldOrphanAdmins` reality check (1 active admin); traced all four actions' guard order.

**Open flags (cumulative):** No 🔴 blocking. New 🟡 ㊴ (last-admin TOCTOU race — low severity). Carried 🟡 ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The UI wiring (28a59e3) → reviewed below.

---

## Review of 28a59e3 — feat(users): admin Users screen — nav tab, gated page, list + Active toggle, Add/Edit/reset modal

**Verdict:** ✅ accept — the UI wires cleanly onto the gated actions with a correct second gate (page redirect) and the **service key proven absent from the client bundle**. Build/tsc/eslint clean. Two minor non-blocking UX/robustness flags, neither a security issue (both fail closed).

**Phase / commit goal (as I understood it):** Wire the gated actions into an admin-only `/dashboard/users` screen — admin-only nav tab, page gate + service-client-merged user list, `UsersAdmin` table/cards with a `setUserActive`-backed Active toggle, and a shared Add/Edit/reset-password `UserModal` — all writes through the Server Actions, never a client supabase call.

**What works (verified by execution):**
- **Page gate is real and fails closed** — `page.tsx` reads the caller's `role,active` (RLS client) and `redirect("/dashboard")` unless active admin; the accountant `gate_passes=false` result from 7a46fa4 applies identically here (same predicate), so an accountant reaching the route at the middleware layer is bounced before the service client runs. Emails (from `auth.users` via the service client) are only fetched *past* the gate.
- **Service key never ships to the browser** — after `npm run build`, grepped all **27** client JS chunks in `.next/static` for the real `SUPABASE_SECRET_KEY` value (42 chars, non-empty — grep was real), the `SUPABASE_SECRET_KEY` name, `sb_secret_`, `auth/v1/admin`, `admin.createUser`, `createServiceClient` → **zero hits**. The `server-only` import on `service.ts` makes a client import a build error; the clean build confirms no client component pulls it.
- **Nav gate** — `DashboardNav` appends the Users tab only when `isAdmin`; `layout.tsx` now selects `role` and passes `isAdmin={profile?.role==='admin'}` (desktop rail + mobile bar). Accountant sees the original 3 tabs. (Tab hiding is convenience; the page/action gates are the boundary.)
- **Active toggle** — `UsersAdmin` reuses the `useOptimistic` + busy-`Set` + `router.refresh()` pattern (matching the reviewed ProductsPricing toggle), calling `setUserActive` (gated) not a client write; renders from the `users` prop (㉜🅐); `stopPropagation` so the toggle doesn't open the edit modal.
- **UserModal** — Add takes email + password ×2 (must match, ≥8 client-side) then reveals credentials once ("won't be shown again"); Edit updates username/full_name/role, has a gated Active toggle and a reset-password sub-form (new ×2, must match); no email edit, no delete. Only the confirmed password is sent.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **㊵ `page.tsx:31` uses `user!.id` (non-null assertion) with no explicit `!user` check**, unlike `actions.ts`/`requireAdmin` which throws on `!user`. Relies on middleware to guarantee auth on `/dashboard/*`; if that ever regressed, the page throws a TypeError (500) rather than redirecting — still **fail-closed** (no data render/leak), just inconsistent. Cheap to align with a `!user` guard. (Same pattern pre-exists in `layout.tsx`.)
- **㊶ Edit-mode role `<select>` is not `disabled` for a self-admin** — it only shows the hint "You can't change your own admin role." A self-admin can pick another role and hit Save, but `updateUserProfile` rejects it server-side ("You can't remove your own admin role"). Fails closed; UX-only — disabling the control (or the last-admin option) would avoid the round-trip.

**Domain / correctness checks:**
- **Authorization** ✓ — page gate verified (predicate identical to the executed accountant probe); nav gate admin-only; all mutations via gated actions.
- **Secret isolation** ✓ — service key/admin API absent from 27 client chunks; `server-only` + clean build.
- **render-from-prop (㉜🅐)** ✓ — `displayUsers` derives from `users` via useOptimistic; each mutation `router.refresh()`.
- **Money / state machine** — N/A.

**What I tried:** Read page.tsx/UsersAdmin.tsx/UserModal.tsx/DashboardNav.tsx + layout diff; `npm run build` exit 0 (`/dashboard/users` = dynamic ƒ); grepped 27 `.next/static` chunks for the secret value/name/admin-API/service-client (zero hits) after confirming the key is 42 chars; reused the executed accountant gate result for the redirect predicate.

**Open flags (cumulative):** No 🔴 blocking. New 🟡 ㊵ (page `user!` non-null assertion — fail-closed, cosmetic), 🟡 ㊶ (self-role select not disabled — server rejects, UX-only). Carried 🟡 ㊴, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Feature is complete and secure. Real-browser follow-ups only: eyeball the create→one-time-credential reveal, an accountant hitting `/dashboard/users` (should bounce), and the Active-toggle flip. When merging `feature/admin-user-management` to main, confirm the three new migrations already reconcile (they do: all 14-digit).

---

## Review of b523d5e — feat(users): show roles as "Sales"/"Accounts"/"Admin" (display labels only)

**Verdict:** ✅ accept — a pure display-label rename, verified to touch **no** stored value, validation, or authorization path. Owner terminology only.

**Phase / commit goal (as I understood it):** Render `salesman→"Sales"`, `accountant→"Accounts"`, `admin→"Admin"` in the Users list and the role dropdown, while leaving the stored identifiers (and everything keyed on them) untouched.

**What works (verified):**
- **Stored identifiers unchanged** — `UserModal` `ROLES[].value` is still `salesman`/`accountant`/`admin`; only `label` changed. So the Add/Edit form still submits the real identifier, which `actions.ts` validates against `["admin","accountant","salesman"]` (unchanged). No desync between UI and the CHECK constraint / RLS / RPCs.
- **No logic depends on the label** — grepped `src` for any `=== / !==` comparison to `"Salesman"|"Accountant"|"Sales"|"Accounts"` → **none**. Labels are render-only; `ROLE_LABEL` (UsersAdmin) and `ROLE_ORDER` (page.tsx sort) are both keyed by the identifiers, so sorting/rendering still resolve.
- **Scope honored** — person-labeling uses of "Salesman" (orders SalesmanFilter caption, pick slip) intentionally left; those name a *person*, not the role enum. Consistent.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Authorization/RLS/RPC — untouched (identifiers are the contract; only display strings changed). Money/state machine — N/A.

**What I tried:** `git show b523d5e`; grep for label-as-logic (none); confirmed `ROLES[].value`, `ROLE_LABEL`/`ROLE_ORDER` keys, and `actions.ts` `ROLES` are all still the 3 identifiers; `npm run build` exit 0.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊴ (last-admin TOCTOU — see 02ffeec: owner won't-fix), ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The ㊵/㊶ fixes (02ffeec) → below.

---

## Review of 02ffeec — fix(users): disable self-role select (㊶) + drop user! non-null assertion (㊵)

**Verdict:** ✅ accept — both non-blocking reviewer flags correctly closed; ㊴ accepted as owner won't-fix. Corroborated by the live e2e run (AD-09 saw the self-role select disabled).

**Phase / commit goal (as I understood it):** Address ㊶ (disable the Edit-modal role select when editing yourself, matching the server-side self-demote guard) and ㊵ (replace `user!` non-null assertions in page.tsx with an explicit `!user` redirect).

**What works (verified):**
- **㊶ CLOSED** — `<select ... disabled={isSelf}>` with `isSelf = mode==="edit" && initial?.id===callerId`. Verified the truth table: **Add** mode → `isSelf=false` → enabled (correct, you set a new user's role); **Edit self** → disabled; **Edit other** → enabled. A self-admin can still save name/username edits because `value={role}` stays their own `admin`, so `updateUserProfile`'s `role!=='admin'` self-demote guard is not tripped — no legitimate self-edit is locked out. Muted `.select:disabled` style added. This is exactly what the live **AD-09** observed ("role dropdown is disabled"). The server guard is unchanged — UI now agrees with it.
- **㊵ CLOSED** — `page.tsx` now `if (!user) redirect("/login")` before using `user.id` (no `!`). `redirect()` throws `NEXT_REDIRECT`, so the subsequent `user.id` is unreachable when unauthenticated — fail-closed *and* assertion-free, consistent with `requireAdmin()` in actions.ts. Middleware still guarantees a user upstream; this is belt-and-suspenders.
- **㊴ won't-fix (accepted)** — the commit documents the owner decision: single owner-admin, microsecond window, a real fix needs DB-level locking/constraint disproportionate to the risk. Reasonable; I'm closing ㊴ as **accepted risk**, not outstanding.

**Blocking issues:** None. **Non-blocking:** None new.

**Domain / correctness checks:** Authorization — the *security* guard (server-side self-demote + last-admin) is unchanged; ㊶ is a UI-alignment, not a new gate. Auth null-handling now fail-closed without assertions. Money/state — N/A.

**What I tried:** `git show 02ffeec`; traced `isSelf` across Add/Edit-self/Edit-other; confirmed `redirect` short-circuits before `user.id`; confirmed the server self-demote guard is untouched; `npm run build` exit 0; cross-checked against live AD-09 pass.

**Open flags (cumulative):** No 🔴, no new flag. **㊵ CLOSED, ㊶ CLOSED, ㊴ CLOSED (won't-fix/accepted).** Carried 🟡 ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The salesman-filter label (33b9056) → below.

---

## Review of 33b9056 — fix(dashboard): salesman filter reads "All" instead of "All salesmen"

**Verdict:** ✅ accept — trivial display-only copy change; filter logic untouched.

**Phase / commit goal (as I understood it):** The SalesmanFilter's default/reset option (collapsed value + dropdown option) reads "All" instead of the redundant "All salesmen" (the "SALESMAN" caption already names the filter).

**What works (verified):**
- **Display-only** — both edits change the string `"All salesmen"→"All"` (the `valueLabel` fallback and the reset `<button>` text). The selection sentinel (`value === "all"`, `onChange(id)`, `selected = salesmen.find(s => s.id === value)`) is unchanged, so filtering behavior is identical — corroborated by the live **AC-03** pass (salesman filter stacks/ANDs correctly).
- No type/data/RLS surface.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** N/A — presentational copy; no data/auth/money/state surface.

**What I tried:** `git show 33b9056` (1 file, 2 lines); confirmed only the label strings changed and the `"all"` sentinel logic is intact; `npm run build` exit 0.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (㊴/㊵/㊶ all closed above.)

**Next-commit suggestion:** Nothing outstanding — `main` is fully reviewed through 33b9056. The user-management feature + Quick Order polish are merged, reviewed, and independently confirmed by the live e2e run (31 real passes; the 3 reported "failures" were verified to be browser-agent artifacts, not code defects).

---

## Review of e91939c — feat(godown): backend — godown role, ready_to_bill, order_item_scans, submit_pick (no UI)

**Verdict:** ✅ accept — the security-critical backend of the godown fulfilment feature, **proven end-to-end by execution** (two rolled-back DO-block probes impersonating real godown/accountant users). Every state-machine edge, the server-authoritative serial capture, global serial uniqueness with cancel-frees, and the fail-closed godown RLS scope all behave exactly as specified. Migration reconciled to the ledger (㉝). No blocking issues.

**Phase / commit goal (as I understood it):** Add the `godown` role + `ready_to_bill` status + `order_item_scans` table, the `submit_pick` RPC (godown-only, approved+LG-only, full-coverage, server-derived serials), guard/`process_order`/`cancel_order` updates, and RLS so godown sees only its queue — no UI.

**What works (verified by live rolled-back execution):**
- **State machine (guard_order_transition), every existing edge intact:**
  - `approved → ready_to_bill` **godown-only** — probe: accountant raw UPDATE → *"only godown may mark an order ready to bill"* (rejected); godown path via `submit_pick` → succeeds. Mirrors admin-only `→ approved`.
  - `ready_to_bill → processed` via `process_order` → **processed** ✓; `ready_to_bill → cancelled` allowed ✓.
  - **`approved → processed` accountant OVERRIDE retained** — probe: accountant `process_order` on an `approved` order → **processed** ✓. (This was my explicit worry; it's preserved.)
- **`submit_pick` (godown's only write path):**
  - **godown-only** — accountant call → *"only godown may submit a pick"* ✓.
  - **approved + approval-brand only** — `FOR UPDATE` lock on the order; status/brand asserted (verified guard against double-submit: a re-pick fails the status assert).
  - **Full coverage** — incomplete (2 of 3) → *'line "LG TV B" needs 1 serial(s), got 0'* ✓; over-scan (n≠qty) is caught by the same `qty <> n` check; unknown line id → rejected.
  - **Server-authoritative serial** — raw `W5LN606NWFG207155IN` stored with `serial=606NWFG207155` (regex `[0-9]{3}[A-Z]{4}[0-9]{6}`); a non-matching manual raw `'manual-xyz  '` stored trimmed → `manual-xyz`. Client-sent serials are ignored — derivation is server-side. ✓
  - **Global serial uniqueness** — within-batch dup → *"serial 606NWFG207155 already recorded on another order"* (row-at-a-time insert names the offender) ✓; cross-order dup (same serial, second order) → rejected ✓.
  - **Stamps + event** — `picked_at`/`picked_by=godown` set, `order_events` `'picked'` logged ✓.
- **`cancel_order` frees serials** — probe: pick o1 (serial recorded) → cancel o1 → **o1 scans deleted (0 left)** → the same serial re-picks cleanly on another order ✓. (Owner's chosen approach over a partial index; delete precedes the status write.)
- **RLS fail-closed + correctly scoped** — `authenticated` has only SELECT on orders/order_items/order_item_scans (no direct writes). As a **real authenticated godown**: sees the `ready_to_bill` LG order, and **not** a `processed` LG order nor a `submitted` Zebronics order (`all_visible_in_scope=true`, total_visible=1). The load-bearing `brands_select_godown`/`retailers_select_godown` policies are present (RLS applies inside the `exists()` subqueries — without them the queue would be empty). Staff selects are unfiltered so `ready_to_bill` is already visible to accountant/admin; `order_item_scans_select_staff` lets them read serials.

**Blocking issues:** None.

**Non-blocking suggestions:** None material. (Design choice noted: once an order is `processed`, godown loses scan visibility via `order_item_scans_select_godown` — correct, godown only needs the pick window; staff retain full visibility.)

**Domain / correctness checks:**
- **State machine** ✓ — additive edges, every prior transition preserved (verified override + submitted/pending/processed paths untouched).
- **Immutable snapshots** ✓ — scans are additive rows; `order_items`/`order_ref` never mutated; `on delete cascade` from order_items only removes scans, never the reverse.
- **Serial integrity** ✓ — server-derived, globally unique, freed on cancel.
- **RLS** ✓ — default-deny, godown scoped to approved/ready_to_bill approval-brand, writes RPC-only, `auth_profile_role()` used consistently.
- **Money** — N/A on the godown surface (no price columns touched).
- **Migration ledger (㉝)** ✓ — `20260709124648_godown_fulfilment` applied + on disk + version/name match; 14-digit, no `T`.

**What I tried:** `git show e91939c` + read the 380-line migration; `list_migrations`/`schema_migrations` vs disk; grants introspection (SELECT-only for authenticated); **DO-block probe #1** (godown-only deny, coverage reject, within-batch dup reject, happy→ready_to_bill + server serial extraction + stamps, ready_to_bill→processed, guard accountant→ready_to_bill deny, approved→processed override) and **#2** (cross-order dup reject, cancel-frees-serial + reuse, RLS visibility as authenticated godown) — both rolled back via terminal RAISE; `tsc`/`eslint`/`build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (㊴/㊵/㊶ closed earlier.)

**Next-commit suggestion:** Routing + status surfacing (837abac) → below.

---

## Review of 837abac — feat(godown): routing + ready_to_bill surfacing (no godown app yet)

**Verdict:** ✅ accept — middleware fencing + status surfacing, all correct and low-risk. The three-way territory logic confines godown to `/godown` and fences everyone else out, without regressing the existing salesman/staff fencing.

**Phase / commit goal (as I understood it):** `ROLE_HOME` godown→`/godown`; confine godown to `/godown/*` and fence salesman/staff out of it; surface `ready_to_bill` in the status tag, the dashboard tab, and the salesman order note.

**What works (verified):**
- **Middleware territory logic** — `wrongTerritory` now: `(salesman && (dashboard||godown)) || (godown && !godown) || (staff && (home||godown))`. Traced each role: godown on any non-`/godown` path → redirect to `/godown`; salesman/accountant/admin on `/godown/*` → redirected to their own home; prior salesman↔dashboard / staff↔home fencing unchanged. `ROLE_HOME[godown]="/godown"` so the redirect target resolves.
- **order-status.ts** — `ready_to_bill → { tone: "accent", label: "Ready to bill" }`, deliberately not the green `processed`; reads as in-flight/read-only, consistent with how `approved` is treated for the salesman.
- **OrdersList** — `ready_to_bill` added to `StatusFilter` type, `STATUS_LABEL`, the tab array, and `tabCounts` (all four sites) — no partial wiring. Realtime refetches on UPDATE, so a `→ ready_to_bill` transition lands in the tab with no extra code.
- **Salesman order detail** — a `ready_to_bill` note ("Picked and ready — the office will bill it shortly."); read-only falls out for free since `editable` only covers submitted/pending_approval and `orders_select_own` has no status filter (so the salesman still *sees* it, but gets no actions).

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Routing/authorization ✓ (godown confined, others fenced out — page gates in commit 3 backstop this); state surfacing ✓; no data/money/RLS change in this commit.

**What I tried:** `git show 837abac`; traced the `wrongTerritory` boolean for all four roles against `/`, `/dashboard/*`, `/godown/*`; confirmed all four `ready_to_bill` insertion points in OrdersList; `tsc`/`eslint`/`build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried as above.

**Next-commit suggestion:** The godown app + scanner (f1ad002) → below.

---

## Review of f1ad002 — feat(godown): the godown app — pick queue, scan screen, @zxing serial scanner

**Verdict:** ✅ accept — a clean, mobile-first godown app: godown-gated, **no price columns anywhere on the surface**, a correctly-managed camera lifecycle, and a pick flow whose client-side guards are all backstopped by the server. `@zxing/browser` added. One trivially-minor non-blocking note (client dedup is best-effort; server is authoritative).

**Phase / commit goal (as I understood it):** Build `/godown` (queue) + `/godown/[id]` (scan/pick screen) with a ZXing 1D scanner, a shared `extractSerial`, batch submit via `submitPick`, and manual-entry fallbacks.

**What works (verified):**
- **Gating + price guardrail** — both pages `getUser()` → fetch `role` → `redirect("/")` if not godown (middleware backstops). Queries select **only** `product_name`/`qty` (+ ref/retailer/time) — no `unit_price_paise`/`line_total_paise` on the godown surface, honoring the owner guardrail literally. Queue scoped to `status='approved'`; pick page redirects if the order isn't `approved` (already-picked can't be re-picked).
- **`extractSerial`** (`src/lib/serial.ts`) — `/\d{3}[A-Z]{4}\d{6}/`, **character-for-character the server regex**; miss → `{ serial: raw.trim(), parsed: false }`. Client uses it for display; server re-derives authoritatively (verified in e91939c).
- **Camera lifecycle (Scanner.tsx)** — tracks start on mount, `controls.stop()` on unmount, **and** the warm-up race handled (`cancelled` flag stops controls that resolve after unmount) — no hot-camera leak on route-away. Insecure-context (no `mediaDevices`) and `NotAllowedError` both fall through to a clear message + the manual-entry path. `onDecode` kept in a ref so the camera effect runs once.
- **Pick flow (PickScreen.tsx)** — tap-to-activate a line; per-line qty cap (`countFor >= qty` blocks), within-order serial de-dup, `✓ count/qty` progress, unparsed scans routed to a confirm/hand-type step, rapid identical-read suppression (2.5s), submit **disabled until every line is complete**, one batched `submitPick`, and `OfflineError` handled so warehouse dead-spots don't lose scans. Remove-chip supported.

**Blocking issues:** None.

**Non-blocking suggestions:**
- **㊷ Client within-order duplicate check is best-effort** — `allSerials` is a `useMemo` over `scans`, so two adds in the same render tick could momentarily see a stale set. Practically shielded by the 2.5s identical-read suppressor and one-at-a-time human scanning, and **fully backstopped server-side** (within-batch dup rejected on submit, proven). Worst case: a duplicate chip that the server rejects with a named-serial message. Cosmetic; no data-integrity risk. Won't-fix is defensible.

**Domain / correctness checks:** Authorization ✓ (godown page gate + no price leak); serial parsing ✓ (mirrors server); resource safety ✓ (camera stopped on unmount/complete); offline resilience ✓; money — N/A (absent by design).

**What I tried:** Read `godown/page.tsx`, `godown/[id]/page.tsx`, `PickScreen.tsx`, `Scanner.tsx`, `serial.ts`; confirmed no price columns in either query; traced camera start/stop + the cancelled-during-warmup path; traced qty-cap/dup/complete gating and the batch payload shape (`{order_item_id, raw_scan}`); `tsc`/`eslint`/`build` clean (`/godown`, `/godown/[id]` compiled).

**Open flags (cumulative):** No 🔴. New 🟡 ㊷ (client dup check best-effort — server-authoritative, cosmetic). Carried 🟡 ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The accountant hand-off (3e7d41e) → below.

---

## Review of 3e7d41e — feat(godown): workbench serial hand-off + Mark processed for ready_to_bill

**Verdict:** ✅ accept — the accountant side of the hand-off: the scanned serials surface for Tally entry and `ready_to_bill` becomes processable. Correct gating on when the section shows; build/tsc/eslint clean.

**Phase / commit goal (as I understood it):** Fetch `picked_at`/`picked_by` + nested `order_item_scans` in the workbench; render a SERIALS / TRACKING section (copyable) for `ready_to_bill`/`processed` orders; add "Mark processed" for `ready_to_bill`; add a "picked" byline.

**What works (verified):**
- **Serials section** — `showSerials = (status==='ready_to_bill' || 'processed') && serialGroups.length>0`. So it's **hidden for fixed brands and approved→processed overrides** (no scans), and shown for picked orders even after processing (scans persist through `process_order`). Serials grouped per line, ordered by `scanned_at` (scan order), with `×count`. **Copy-all** writes `name\nserials…` blocks to the clipboard with "Copied ✓" feedback and a graceful failure message — sensible since the accountant re-keys into Tally.
- **Mark processed** — the button predicate gains `ready_to_bill` alongside `submitted`/`approved`; `process_order` accepts `ready_to_bill` (verified live in e91939c). The `approved→processed` override button is unchanged.
- **Data path** — the workbench query nests `order_item_scans(id, serial, scanned_at)` under `order_items` and adds `picked_at` + `picked_by_profile`; staff can read scans via `order_item_scans_select_staff` (verified). Byline appends "· picked {time} by {name}" when `picked_at` is set.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Authorization ✓ (staff RLS covers the scan embed); state machine ✓ (Mark processed only for processable statuses; RPC enforces); serials read-only display ✓; money — the workbench still shows prices to staff (correct — this is the accountant view, not the godown).

**What I tried:** `git show 3e7d41e` (page.tsx embed + OrderWorkbench diff); confirmed the `showSerials` gate, scan-order sort, copy-all payload, and the processable-status predicate; verified staff scan-select RLS exists; `tsc=0`/`eslint=0`/`build` exit 0.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Godown fulfilment (commits 1–4) is complete and backend-verified. Remaining confidence step is a **real-device pass** (HTTPS): scan a physical LG barcode on a phone (secure-context camera), confirm a full pick → `ready_to_bill` → accountant serials + Mark processed. When merging `feature/godown-fulfilment` to main, the single migration is already 14-digit/reconciled.

---

## Review of c3d7653 — fix(pwa): installable WebAPK — minimal service worker + standard static icons

**Verdict:** ✅ accept — a correct, low-risk PWA installability fix: a no-op passthrough service worker + standard-sized static icons that satisfy Chrome's WebAPK minter. No behavior change to the app itself; build/tsc/eslint clean. *(Reviewed out of order per request — see note: 24ec59b sits unreviewed just below.)*

**Phase / commit goal (as I understood it):** Make Android "Add to Home screen" install a real WebAPK (receipt icon, no Chrome badge, standalone) instead of a badged shortcut — which needs (a) a registered service worker with a real fetch handler and (b) manifest icons the minter reliably fetches.

**What works (verified):**
- **Icons match the manifest exactly** — `sips` confirms `icon-192.png`=**192×192**, `icon-512.png`=**512×512**, `icon-maskable-512.png`=**512×512**, matching the three `manifest.ts` entries (`192x192 any`, `512x512 any`, `512x512 maskable`). A size mismatch is a common cause of the install falling back to a shortcut; these are exact. No lingering `1000x1000`/`1250x1250`/`/icon.png` refs remain in the manifest.
- **Service worker is genuinely minimal + installability-only** — `public/sw.js` (served at `/sw.js`, scope `/`): `install→skipWaiting`, `activate→clients.claim`, `fetch→respondWith(fetch(event.request))`. A straight network passthrough — **no caching, so no staleness/offline-regression class of bugs** — but a non-trivial handler, which is exactly what Chrome requires to promote to a WebAPK (a no-op handler is skipped). The comment documents this rationale accurately.
- **Registration is safe** — `SwRegister` (client, renders `null`) registers in a `useEffect` guarded by `"serviceWorker" in navigator`, with a `.catch` no-op (old browsers / private mode → no prompt, app unaffected). Imported once, rendered in `<body>` in the root layout.
- **Build** — `npm run build` exit 0; `/manifest.webmanifest` emitted as a static route.

**Blocking issues:** None.

**Non-blocking suggestions:**
- **First-load control handoff** — `skipWaiting` + `clients.claim` means the SW takes control of already-open clients immediately on first activation; with a pure passthrough this is benign (no cache to serve stale). If caching is ever added to `sw.js` later, revisit the update strategy so a new deploy can't be masked by a stale SW. (Forward-looking only; nothing to change now.)

**Domain / correctness checks:** No data/RLS/money/state-machine surface — this is static assets + a passthrough SW + a client registration. Offline behavior is explicitly unchanged (passthrough, no cache).

**What I tried:** `git show c3d7653`; `sips` pixel dimensions on all three icons vs the manifest sizes; confirmed `public/sw.js` scope + handlers; grep for stale icon refs (none); confirmed single `SwRegister` import/render; `npm run build` exit 0 with `/manifest.webmanifest`. (Actual install promotion is a real-device/HTTPS check — Chrome DevTools → Application → Manifest/Service Workers on the deployed URL — noted as the one thing not verifiable from here.)

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷ (godown client dup — cosmetic), ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** **24ec59b — feat(users): "Godown" role in user management** is still **unreviewed** (it landed on main between the godown work and this PWA fix). Review it next to close the gap.

---

## Review of 24ec59b — feat(users): "Godown" role in user management (all four spots)

**Verdict:** ✅ accept — the godown role is now creatable/editable through the admin Users screen, with all four app-layer spots updated consistently and the DB CHECK confirmed to accept it. No security-guard impact. *(Reviewed after c3d7653 per request — commit actually predates it on main.)*

**Phase / commit goal (as I understood it):** Let an admin create/edit a `godown` user in-app (not just via the SQL runbook): add `godown` to the server-action role whitelist, the modal dropdown, the list label map, and the sort order.

**What works (verified):**
- **Server validation accepts godown** — `actions.ts` `ROLES` is now `["admin","accountant","salesman","godown"]`, so `createUser`/`updateUserProfile`'s `ROLES.includes(role)` passes for godown (without this the action would reject a godown create even with a valid form). The `Role` union type widens accordingly (tsc clean).
- **DB accepts godown** — rolled-back probe: `update profiles set role='godown'` succeeds against `profiles_role_check` (the constraint gained `'godown'` in e91939c, applied live). So the full create path (auth create → trigger → `profiles.update role='godown'`) has no CHECK violation.
- **All role maps consistent** — grepped every role map in `src`: `UserModal.ROLES` (dropdown), `UsersAdmin.ROLE_LABEL` (→ "Godown"), `page.tsx ROLE_ORDER` (godown: 3, sorts after salesman instead of the `?? 9` bucket), and `middleware.ROLE_HOME` (godown→/godown, from 837abac) — **all five include godown**; none missed. Owner-facing labels stay display-only over the stored identifiers ([[b523d5e]] pattern).
- **Guards unaffected** — self-lockout + last-admin key on `'admin'` only, so introducing godown doesn't touch them (a godown user is just another non-admin; the page/action admin gate treats it like salesman/accountant → no access to `/dashboard/users`).

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Authorization ✓ (godown is a non-admin everywhere the gate matters; verified earlier that only `role==='admin'` passes the Users gate); role identifier vs label separation intact; DB CHECK ✓; no money/state-machine surface.

**What I tried:** `git show 24ec59b`; grep of all `ROLE_*`/`ROLES` maps to confirm none omitted godown; live rolled-back `profiles` update to `role='godown'` (accepted by the CHECK); `npm run build` exit 0; tsc/eslint clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷ (godown client dup — cosmetic), ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** `main` is now fully reviewed through c3d7653. (A `godown-scanner-improvements` prompt is staged in the tree — torch/format-hints/scan-region crop for the pick screen — so a follow-up scanner branch is expected next.)

---

## Review of 800b6a1 — fix(pwa): exclude sw.js + manifest.webmanifest from the auth proxy matcher

**Verdict:** ✅ accept — correct, narrowly-scoped fix: the two public PWA metadata paths now bypass the auth proxy (which was 307-ing them to /login and killing the install prompt). Regex verified to exclude *only* those two paths — no auth-bypass surface introduced.

**Phase / commit goal (as I understood it):** Chrome's installability checker fetches `/manifest.webmanifest` and `/sw.js` **without** session cookies; the auth proxy redirected both to `/login`, so no install prompt. Add both to the matcher's exclusion list.

**What works (verified):**
- **Regex excludes exactly the right paths** — tested the new matcher in node: `/sw.js` and `/manifest.webmanifest` → **not** matched (proxy skipped); `/dashboard`, `/godown/abc`, `/login`, `/api/x` → still matched (proxy runs); crucially `/manifest.webmanifest/evil` → **still matched** (the alternatives aren't anchored to swallow sub-paths, so no protected route can be smuggled past auth by suffixing). No auth bypass.
- **Nothing sensitive exposed** — both are public metadata: the manifest is app branding; `sw.js` is the network-passthrough script reviewed in c3d7653 (no secrets, no data). They never needed the session.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Authorization ✓ — exclusion is limited to two static public assets; every real route (and any `/manifest.webmanifest/*` sub-path) still passes through the auth proxy. No RLS/data/money surface.

**What I tried:** `git show 800b6a1`; ran the exact matcher regex against 7 paths in node (excludes only sw.js/manifest, sub-paths still gated); confirmed `src/proxy.ts` is the middleware entry (build shows "ƒ Proxy (Middleware)").

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Maskable icon padding (ffcc480) → below.

---

## Review of ffcc480 — fix(pwa): more safe-zone padding in the maskable icon (glyph 80% → 58%)

**Verdict:** ✅ accept — icon-only regen; the new maskable icon is the right size and genuinely opaque, fixing both the congested-in-circle look and the transparent-centre-renders-black risk.

**Phase / commit goal (as I understood it):** Regenerate `icon-maskable-512.png` with the glyph at ~58% (inside Android's circle safe zone) on an opaque white ground.

**What works (verified):**
- **Dimensions correct** — `sips`: **512×512**, matching the manifest's maskable entry.
- **Genuinely opaque** — PIL alpha extrema: **min 255 / max 255**, i.e. every pixel fully opaque. So even though the PNG carries an alpha channel (`hasAlpha: yes`), there are **no** transparent pixels — the "transparent centre renders black on some launchers" failure the commit targets is actually resolved, not just claimed.

**Blocking issues:** None. **Non-blocking:** None material. (The retained-but-unused alpha channel is harmless; a truly channel-less PNG would be marginally smaller — not worth a re-encode.)

**Domain / correctness checks:** N/A — static asset; no data/logic surface. Only the `maskable` manifest entry consumes it.

**What I tried:** `git show ffcc480 --stat` (binary, 34200→24995 bytes); `sips` dims + `hasAlpha`; PIL alpha extrema to confirm full opacity. (Actual in-circle appearance is a device/DevTools check.)

**Open flags (cumulative):** No 🔴, no new flag. Carried as above.

**Next-commit suggestion:** The scanner targeting rewrite (5dbfbaa) → below.

---

## Review of 5dbfbaa — feat(godown): scanner targeting — reticle-crop decode loop, torch, format hints, serial filter

**Verdict:** ✅ accept — a well-engineered scanner rewrite that fixes the "grabs the wrong barcode" problem with **three independent targeting layers**, keeps the camera lifecycle leak-free, and keeps ZXing out of every non-godown bundle. No backend/RPC/RLS change. One trivial doc-drift note.

**Phase / commit goal (as I understood it):** Replace ZXing's whole-frame `decodeFromVideoDevice` (which locked onto the EAN-13/QR) with an owned stream + throttled reticle-crop decode loop, format hints, a serial content-filter, and torch — so only the LG serial barcode inside the on-screen window is read.

**What works (verified):**
- **Three targeting layers, all present:** (1) **format hints** restrict the decoder to `CODE_128/39/93` (EAN-13 + QR never attempted); (2) **reticle-crop** — each tick draws only the centered 90%×28% window (mapped through the `object-fit: cover` math into intrinsic pixels) onto a reused offscreen canvas and decodes *that* — a QR above or EAN beside the window is never in the canvas (WYSIWYG); (3) **content-filter** — a decode not matching `\d{3}[A-Z]{4}\d{6}` is **silently ignored** (`extractSerial(raw).parsed === false → return`), no fix-it card.
- **`PendingConfirm` deleted from the scan path** — the "doesn't look like an LG serial" card is gone; the only manual path is the deliberate per-line "Or type a serial…" field (unchanged). handleDecode keeps the 2.5s identical-read suppressor, qty cap, and within-order de-dup.
- **`decodeFromCanvas` is real** — confirmed present in the installed `@zxing/browser@0.2.1` (BrowserCodeReader base), not merely type-satisfied.
- **Torch ON by default, capability-gated** — `getCapabilities().torch` → `applyConstraints({advanced:[{torch:true}]})`, on-screen toggle, iOS/torchless degrade silently. Cleanup turns **torch off before stopping tracks** (some devices leave the LED lit).
- **Leak-free lifecycle** — one reused canvas + one reader; `clearInterval` + torch-off + `stream.getTracks().stop()` on unmount; the getUserMedia **warm-up race** handled (`cancelled` → stop the just-resolved stream and return). With `decodeFromCanvas` (one-shot) the reader holds no stream/timer, so no `reset()` needed.
- **Performance shape per spec** — throttled `setInterval` (not per-rAF), native-resolution capture but **decode only the crop**, downscaled to ≤1400px on high-res sensors, `willReadFrequently` on the 2D context.
- **Bundle split holds** — ZXing is dynamic-imported in Scanner **and** preloaded on `/godown` mount (`PreloadScanner`, same specifiers → same async chunks). Verified: `rootMainFiles` (loaded on every route) contains **no** ZXing; it lives only in dedicated `node_modules_@zxing_*` async chunks. Never in the salesman/accountant/admin initial bundles.

**Blocking issues:** None.

**Non-blocking suggestions:**
- **Doc drift** — the Scanner header comment still says "throttled ~9 Hz decode loop"; the `DECODE_MS` constant is 110 here but is lowered to 50 (~20 Hz) in the very next commit (18a47f7), leaving the prose stale. Cosmetic; update the comment when the file is next touched.

**Domain / correctness checks:** No backend/RPC/RLS/state/money change (scanner component + CSS only, as the guardrail requires); `submit_pick`/serials/state machine untouched (still server-authoritative). Resource safety ✓ (camera+torch+loop all stopped on unmount/complete). Secure-context + permission-denied fallbacks preserved.

**What I tried:** Read the full `Scanner.tsx`, `PreloadScanner.tsx`, and the `PickScreen.tsx` diff (PendingConfirm removed, content-filter moved into handleDecode); confirmed `decodeFromCanvas` in `node_modules/@zxing/browser`; traced the object-fit:cover→reticle crop math and the cleanup/warm-up-race; verified the dynamic-import split against `rootMainFiles`; `tsc`/`eslint`/`build` clean.

**Open flags (cumulative):** No 🔴, no new flag (doc-drift noted inline, cosmetic). Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** The decode-rate tune (18a47f7) → below.

---

## Review of 18a47f7 — tune(godown): scanner decode loop 9 Hz → 20 Hz (DECODE_MS 110→50)

**Verdict:** ✅ accept — a one-constant owner-tuned change (snappier lock-on), safe because the reticle crop — not the decode rate — bounds the per-tick work.

**Phase / commit goal (as I understood it):** After device testing, halve the decode interval (110ms→50ms, ~9→20 Hz) for faster barcode lock-on.

**What works (verified):**
- **One-line constant change** — `DECODE_MS 110 → 50`; the loop still decodes only the ≤1400px reticle crop, so each tick is the same cheap work at ~2× frequency. Trivially reversible if an older phone runs warm (the commit says as much). No structural change.

**Blocking issues:** None. **Non-blocking:** carries forward the stale "~9 Hz" header comment noted in 5dbfbaa — this commit is what makes it ~20 Hz.

**Domain / correctness checks:** N/A — a throttle constant; no data/logic/lifecycle change.

**What I tried:** `git show 18a47f7` (1 line); confirmed the crop/downscale bound is unchanged so 20 Hz stays cheap; `build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried as above.

**Next-commit suggestion:** The Quick Order polish (36cd303) → below.

---

## Review of 36cd303 — polish(new-order): bigger Quick Order type + fix price-input clip; scanner continuous autofocus

**Verdict:** ✅ accept — presentational type/legibility tweaks + a real clip fix, plus a capability-gated continuous-autofocus on the scanner. Low risk, build clean.

**Phase / commit goal (as I understood it):** Bump Quick Order type sizes for legibility, widen the unit-price input so "Unit price" stops clipping to "Unit pri", enlarge the FlowHeader title, and add continuous autofocus to the scanner.

**What works (verified):**
- **Quick Order CSS** — brand header 13→15px (+ sticky offset var 34→36px kept in sync), product name 13→15px, price line 12→13px, row min-height 48→52px. The clip fix is real: `.priceInput` width **68→80px** with font **15→13px** — a wider box + smaller figures fits the "Unit price" placeholder. FlowHeader `.title` → 18px. All CSS-module scoped; no logic.
- **Continuous autofocus (Scanner)** — `getCapabilities().focusMode?.includes("continuous")` → `applyConstraints({advanced:[{focusMode:"continuous"}]})`, **capability-gated exactly like torch**, silent skip + keep default focus when unsupported (no crash). Cuts focus-lock lag.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** No data/RLS/money/state surface — CSS + a capability-gated MediaTrack constraint. Autofocus failure is caught and ignored (fail-safe).

**What I tried:** `git show 36cd303` (QuickOrder/FlowHeader CSS + the Scanner focusMode block); confirmed the focusMode path is capability-gated + try/caught like torch; `tsc`/`eslint`/`build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** `main` is fully reviewed through 36cd303. Remaining confidence step is the owner's **device retest on the deployed HTTPS URL** (torch on, EAN/QR ignored, out-of-reticle codes not read) — the camera path is the one thing not verifiable from here.

---

## Review of ab3d8c7 — feat(orders): shareable order — mobile Share / desktop Copy

**Verdict:** ✅ accept — a clean shared Share/Copy affordance: WhatsApp-friendly plain text (no link, since the pages are auth-gated), feature-detected after mount to avoid a hydration mismatch, money via `formatRupees`. Two placements, one shared builder.

**Phase / commit goal (as I understood it):** Add a Share button (Web Share on mobile, clipboard Copy on desktop) that shares an order as plain text — on the salesman order detail (full copy incl. prices) and the pick slip (respecting its Prices toggle).

**What works (verified):**
- **No-URL plain text** — `buildOrderShareText` emits header + ref/brand + `ORDER COPY`/`PICK SLIP` + meta + `{n} LINES` + per-line `qty × name [@ rate = amount]` + total + notes. A link would be useless to a non-user (auth-gated), so sharing the content is the right call. Money is `formatRupees` throughout — no raw paise.
- **No hydration mismatch** — `ShareOrderButton` starts with `canShare=false` (label "Copy order") and flips to `navigator.share` support in a post-mount `useEffect`, so SSR and first client render agree. A dismissed share sheet (`AbortError`) and a blocked clipboard are both swallowed quietly.
- **`withPrices` mirrors the sheet** — off → "PICK SLIP" + qty/item only; on → "ORDER COPY" + priced lines + total.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Money ✓ (`formatRupees`, en-IN, no raw paise); no data/RLS/state surface (read-only text from already-fetched props); auth ✓ (no link shared, content only).

**What I tried:** Read `order-share.ts` + `ShareOrderButton.tsx`; confirmed the post-mount feature-detect, AbortError/clipboard swallow, and `formatRupees` money; `build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Quick Order model-name search (692fe7d) → below.

---

## Review of 692fe7d — feat(new-order): Quick Order search also matches Tally/model name

**Verdict:** ✅ accept — one-line search widening (OR in `tally_name`), null-safe (the column is NOT NULL), no downside for fixed brands.

**Phase / commit goal (as I understood it):** Let the salesman search find an LG unit by its model code (e.g. "43UA73806LA") by matching `tally_name` in addition to name/category/brand.

**What works (verified):**
- **`normalize(p.tally_name).includes(q)` OR'd into `matchesSearch`** — `normalize` lowercases + strips whitespace, so "43UA73806LA" matches `tally_name` "LG 43UA73806LA". Brand lock/filter still ANDs on top (unchanged).
- **Null-safe** — I confirmed live that `products.tally_name` is **NOT NULL**, so `normalize(p.tally_name)` can't throw; and the `ProductOption.tally_name` field is populated in the page mapping (from e49fd07). Fixed brands whose `tally_name == name` gain nothing; only LG (distinct model codes) benefits.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Read-only client filter; no data/RLS/money/state surface.

**What I tried:** `git show 692fe7d`; read `normalize`; live check that `products.tally_name is_nullable = NO`; `build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried as above.

**Next-commit suggestion:** Pick-slip model + always-on prices (6a5e25a) → below.

---

## Review of 6a5e25a — feat(pick-slip): show LG model (tally name) + always-on prices

**Verdict:** ✅ accept — the pick slip becomes a true ORDER COPY (prices always on) with the LG model line under the display name; join is null-safe and the model render is guarded against `X == X`.

**Phase / commit goal (as I understood it):** Always show prices (drop the off/on toggle) and add a `tally_name` model line under the product name for `show_model` brands, joined via `order_items.product_id → products`.

**What works (verified):**
- **Model line guarded + null-safe** — `showModel && item.tally_name && item.tally_name !== item.product_name` (same pattern as Quick Order — no "X·X"); the page maps `tally_name: it.products?.tally_name ?? null`, so a missing join is `null` (line simply omitted). `products(tally_name)` resolves because ordered products can't be hard-deleted (verified in 81b7547's FK/guard review).
- **Always-on prices** — the toggle + all `pricesOn &&` conditionals are gone; RATE/AMOUNT columns, the per-line money, and the Total row are unconditional; the badge is a constant "ORDER COPY"; `buildOrderShareText` is called with `withPrices: true`. Money via `formatRupees`.
- **Query extended** — `brands(... show_model)` + `order_items(... products(tally_name))`; `showModel` threaded to the component.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** Money ✓ (`formatRupees`, no raw paise); RLS unchanged (same page query, just more columns — all readable by staff); no state surface. The godown reads qty in `/godown`, so an always-priced accountant sheet is the owner's intent, not a leak.

**What I tried:** `git show 6a5e25a` (page.tsx + PickSlip.tsx); confirmed the guarded/null-safe model render, the toggle removal, and `formatRupees`; `build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried as above.

**Next-commit suggestion:** Admin/godown polish + "Billed" rename (dc856a2) → below.

---

## Review of dc856a2 — feat(admin+godown): search bars, godown model name, white price input, "Billed" label

**Verdict:** ✅ accept — search boxes on Products/Retailers, the LG model on the godown pick screen, and a user-facing "Processed"→"Billed" rename **verified to be label-only** (the stored `processed` value and every guard/RLS untouched). No price leak on the godown surface.

**Phase / commit goal (as I understood it):** Client-side search on Products/Retailers; show the LG model on the godown pick screen; white price input; rename the user-facing "Processed" to "Billed" everywhere it shows.

**What works (verified):**
- **"Processed"→"Billed" is display-only** — grepped `src`: **no** code compares status to the string `"Billed"`/`"Processed"`; every branch still keys on the stored value `order.status === "processed"` (`order-status.ts` label, `order-events.ts` "Billed by", OrdersList tab, OrderWorkbench byline + confirm/"Mark billed" button, salesman note). `handleProcess` still calls `process_order` (writes DB `processed`). No migration — the state machine/guards/RLS are untouched. The status *tone* stays `processed` (green).
- **Products search** — filters `displayProducts` by name/`tally_name`/category/brand with a no-match empty state; feeds both the table and mobile groups. Null-safe (`tally_name` NOT NULL; brand via `?? ""`). Renders from the optimistic prop, so the Active toggle still reconciles.
- **Godown model** — the pick screen now shows `tally_name` before the product name (muted), joined via `order_items→products`, gated by `show_model`. Crucially the godown query **still selects no price columns** (only `product_name, qty, position, tally_name` + `brands(show_model)`) — the price guardrail holds.
- **White price input** — CSS only.

**Blocking issues:** None. **Non-blocking:** None.

**Domain / correctness checks:** State machine ✓ (rename is cosmetic; DB `processed` + guards intact); godown price guardrail ✓ (no price columns); search null-safety ✓; no money/RLS regression.

**What I tried:** `git show dc856a2`; grep for any logic keyed on the display strings (none) + confirmed all `=== "processed"` comparisons remain; verified the godown query selects no price column; `tsc`/`eslint`/`build` clean.

**Open flags (cumulative):** No 🔴, no new flag. Carried as above.

**Next-commit suggestion:** The generated PDF pick slip (9f686be, on `feature/pickslip-pdf`) → below.

---

## Review of 9f686be — feat(pick-slip): real generated A5 PDF replaces window.print

**Verdict:** ✅ accept — a proper server-streamed A5 PDF, **RLS-gated** (no service client), with the PDF library kept out of every client bundle and a sensible WinAnsi glyph strategy. Render path **verified by execution** (valid 1-page A5). On `feature/pickslip-pdf`.

**Phase / commit goal (as I understood it):** Replace `window.print()` with a "Download PDF" link to a server route that streams a generated A5 ORDER COPY (`@react-pdf/renderer`), reusing the RLS-scoped pick-slip query; keep the on-screen sheet + Share.

**What works (verified):**
- **RLS is the access gate** — `route.ts` uses the RLS-scoped **server** client (`@/lib/supabase/server`), the *same* select as the pick-slip page; `maybeSingle()` → `!order` → **404**. No service client, no new RLS/columns — a caller who can't see the order gets nothing. `runtime = "nodejs"` (react-pdf needs Node). Response is `application/pdf`, `Content-Disposition: inline; filename="<order_ref>.pdf"`, `Cache-Control: no-store`.
- **Render path executes to a valid PDF** — I rendered a probe through `@react-pdf/renderer`'s `renderToBuffer` with the component's exact fonts (Helvetica/Courier) and `pdfMoney`/`pdfText` logic → **`%PDF-`, 1 page, A5**. The layout mirrors the sheet: header + ORDER COPY badge, meta, `{n} LINES`, QTY·ITEM·RATE·AMOUNT with the guarded LG model line (`showModel && tally_name && tally_name !== product_name`), Total (incl. GST), notes box, Packed/Checked signatures, generated-at footer.
- **Money never raw paise** — `pdfMoney` = `formatRupees` with the ₹ stripped to `"Rs "` (the built-in fonts are WinAnsi and have no ₹/⋆). `pdfText` maps known symbols (⋆→*, ・→·, smart quotes) and squashes any other non-Latin-1 char to `"?"` so the encoder never prints a wrong glyph — a fix the commit notes was **caught by executing the render**, which I credit.
- **PDF lib absent from client bundles** — after build, grepped `.next/static` for `react-pdf`/`renderToBuffer` → **empty**; it appears only in server chunks. `renderPickSlipPdfBuffer` keeps JSX out of `route.ts`. Route present as `ƒ /dashboard/orders/[id]/pick-slip/pdf`.
- **Button swap** — Print → "Download PDF" link (`target="_blank" rel="noopener"`, `orderId` threaded from the page); on-screen sheet kept as preview; Share untouched; dead `@media print` + `.toggle*` CSS removed.

**Blocking issues:** None.

**Non-blocking suggestions:**
- **"Rs" vs ₹ is a deliberate v1** — the built-in fonts can't render ₹; registering Space Grotesk / JetBrains Mono (or any ₹-capable font) via `Font.register` is the planned follow-up and would restore the rupee glyph + the app's real type. Fine to ship as-is.
- **`pdfText` collapses newlines** in `notes` to single spaces (`\s+ → " "`). Acceptable for a one-line notes field; if multi-line notes matter later, preserve `\n`.

**Domain / correctness checks:** Authorization ✓ (RLS server client, 404 on no-row, no service client); money ✓ (`formatRupees`, no raw paise); no schema/RLS/RPC change (guardrail honored); bundle isolation ✓ (server-only). Secure — the route can't leak an order the caller couldn't already see on the page.

**What I tried:** Read `route.ts` + `PickSlipPdf.tsx`; confirmed the RLS server client + 404 + headers + `nodejs` runtime; **executed a `renderToBuffer` probe** (valid 1-page A5, %PDF, "Rs 15,000", glyph map); grepped `.next/static` for react-pdf (absent) and confirmed server-only; `tsc`/`eslint`/`build` clean, route present.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Feature branch is complete + verified. Owner phone test on the deployed HTTPS URL (tap Download PDF → native viewer → share to WhatsApp; confirm the LG model line + prices + 404 for a non-visible order). Font registration (₹ glyph) is the natural follow-up. `feature/pickslip-pdf` is merge-ready.

---

## Review of 34b73d4 — feat(fulfilment): all-brand + partial pick → backorder split (migration + pick UI)

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Stage 1 core of the fulfilment overhaul. Every brand now routes to `approved` (the godown fulfils all, not just LG). The godown picks brand-aware — LG scans serials, fixed brands enter a per-line qty — and a pick may be **partial**. A short pick **splits** the order: the original ships the picked qty (ordered snapshot kept immutable via a new `order_items.picked_qty`; `orders.total_paise` recomputed to the SHIPPED total), and a new `backorder` child (same salesman, `parent_order_id` link, fresh gapless `order_no`) holds the remainder; `punch_order` re-enters it. Scope = the migration + the godown pick screen; the backorder/detail *surfaces* are the next commit.

**What works (verified by execution — 4 live rolled-back probes + build):**
- **Partial split, fixed/qty path** (migration L441-476): pick 3 of a 5-qty line + 3 of a 3-qty line → original `ready_to_bill`, `total_paise=230700` = SHIPPED Σ(3×13500 + 3×63400), **not** the ordered 257700; child `backorder` total 27000 = 2×13500, `order_no` 1053 > parent 1052, `same_salesman=true`, `parent_ok=true`; only the short line backordered (fully-picked line omitted).
- **Immutability held** (checklist): the ordered line snapshot is never rewritten — P1 `line_total_paise` stayed 67500 (=5×price) though only 3 shipped; `picked_qty=3` is purely additive.
- **LG/scan path** (L406-433): 2 scans on a 3-qty line + 2 on a 2-qty line → `picked_qty`=(2,2); serials extracted **server-side** from raw (`PRE123ABCD100001IN`→`123ABCD100001`); within-bill dedup live; shipped total 3000000; child = 1×LG1 remainder.
- **All-brand approve routing** (L74): a FIXED-brand pending order → `approve_order` → `approved` (was: straight to ready_to_bill).
- **Guard edges** (L87-146): `pending_approval→ready_to_bill` direct now **rejected**; `backorder→pending_approval` allowed for the salesman-owner (punch). Guard is **BEFORE UPDATE only** (pg_trigger audit) so the `backorder`/`pending_approval` INSERTs bypass it — no false reject.
- **≥1-unit floor** (L436): picking 0 across the order → "pick at least one unit to submit". **Full pick = no split** (child_ct 0). **`punch_order`** (salesman) → `pending_approval`, resets the edit window (L484).
- **RLS all-brand pickup** (L523-535): acting as `godown` under RLS, a fixed-brand (`requires_scan=false`) `approved` order is now visible (count 1; was 0 under the old brand gate). `order_items` mirrored; the scans policy was already status-only, correctly left untouched.
- **Total-recompute trigger** wired AFTER INS/UPD/DEL on `order_items` → `Σ(coalesce(picked_qty,qty)×unit_price)`; pre-pick equals the old `Σ(line_total)`, so existing order totals are unchanged (L25-43).
- `npm run build` clean (tsc + eslint) at 34b73d4; `/godown/[id]` + `/scan/[id]` compile with the new `submit_pick(p_order_id, p_lines)` signature.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- A backorder created now is **not yet actionable in the UI** — the chip/tone, the "Pending scan"/To-pick relabel, the Punch button, and the picked-vs-ordered detail are the *next* commit (072e423). At 34b73d4 a backorder renders via graceful defaults (status chip → `{tone:locked, label:"backorder"}`; `backordered` event → `time + action`) — **no crash** (confirmed 34b73d4 doesn't touch order-status.ts/order-events.ts; defaults pre-existed), just not user-usable until the surfaces land.
- Child `editable_until = now()` (already-expired) is cosmetically odd but harmless — a `backorder` is editable by status (not window) in `update_order_items`, and `punch_order` resets it.

**Domain / correctness checks:** State machine ✓ (edges guard-enforced, verified live). Order numbering ✓ (child draws monotonic `order_no` from the sequence; gap-tolerant per D1). Immutable snapshots ✓ (ordered qty/price/line_total untouched — proven). RLS ✓ (godown all-brand `approved`, live role-switched impersonation). Money ✓ (integer paise, bigint mult, shipped totals exact). Locking ✓ (`select … for update` on the order in submit_pick).

**What I tried:** `pg_trigger` timing/event audit (guard=BEFORE UPDATE, recompute=AFTER I/U/D). 4 live rolled-back DO-block probes impersonating godown/admin/salesman via `request.jwt.claims` + role-switch: (1) fixed-qty partial split; (2) LG-scan partial split + serial extraction; (3) approve fixed→approved + full-pick-no-split + zero-pick reject + punch + pending→ready_to_bill reject; (4) RLS godown-sees-fixed-approved. `npm run build`.

**Open flags (cumulative):** No 🔴, no new flag. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (Stage 2 dispatch parked — `dispatched` correctly absent from the status CHECK.)

**Next-commit suggestion:** The surfaces (072e423) — verify a salesman can see + Punch his backorder, the picked-vs-ordered detail reads right, and the "Pending scan"/To-pick relabel is label-only (DB status stays `approved`).

---

## Review of 072e423 — feat(fulfilment): backorder + shipped surfaces (chip/tab/tone, detail, punch)

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** The Stage-1 frontend surfaces for what 34b73d4's backend created — a `backorder` chip/tone + a Backorder tab, the picked-vs-ordered detail with the shipped total, the "N units backordered → {child ref}" note, and the "Backorder of {parent}" + Punch Order flow. No backend change.

**What works (verified — read + build + reconciliation):**
- **Chip/tone:** `backorder` → violet "Backorder" (StatusTag + order-status.ts L21); `approved` stays "Pending scan" (owner decision, explicitly *not* "To pick" — per commit msg + owner).
- **Backorder tab:** `StatusFilter` + `STATUS_LABEL` + `tabCounts` + the tab array all carry `backorder` (OrdersView L45/49/190/238), placed right after "All"; a salesman sees his own by RLS (the child keeps `salesman_id`).
- **Punch flow:** `punchOrder` wrapper (order-rpcs.ts L133, added at 34b73d4) → `handlePunch` (L304) → the "Punch order" button (L461, salesman-owner or admin) + "Backorder of {parent ref}" link (L451). A `backorder` is editable (salesman Edit now covers it — matches the RPC's `v_editable` for status='backorder').
- **Picked-vs-ordered + shipped total reconcile EXACTLY:** a short line shows `{picked}/{qty}` (L601); view-mode line AMOUNT = `rate × pickedQty` (L612) and the total row = `order.totalPaise` (L685, the DB shipped total). Since `Σ rate×picked_qty` == the recompute trigger's `Σ picked×unit_price` == `total_paise`, **the lines sum to the total**. Edit mode uses ordered/live figures. `backorderedUnits = Σ max(0, qty−picked_qty)` (L172); child ref read off the `backordered` event details (L177-184) — both correct.
- **Events:** `backordered` → "Backordered → {ref}", `picked` → "Picked … {n}/{m}" (order-events.ts).
- `npm run build` clean (tsc + eslint) at the current tree (8 changed FE files).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:**
- **Stale comment, order-status.ts L24:** "Fixed brands never hold this status (they jump to ready_to_bill)" is now false — 34b73d4 routes every brand to `approved`. Behavior is fine; the comment misleads a future reader — tidy it. (The "Pending scan" label showing on a *picked-not-scanned* fixed-brand `approved` order is the owner's explicit call, not a defect.)

**Domain / correctness checks:** Money ✓ (view total = DB shipped `total_paise`; lines reconcile; no client recompute drift). RLS ✓ (salesman's own backorder visible; no policy touched here). State machine ✓ (Punch gated by status='backorder', server-enforced by punch_order + guard). Immutable snapshots ✓ (display reads `picked_qty` additively; ordered qty untouched).

**What I tried:** Read the detail lines/total render + the punch / backorder-child derivation; grepped the tab wiring; confirmed `punchOrder` exists + is imported; re-ran `npm run build` at the current tree.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (Trivial: the L24 stale comment above — not ledger-tracked.)

**Next-commit suggestion:** A phone pass on the deployed URL — partial-pick a real order and confirm the salesman sees the shipped detail + his Backorder tab + Punch works end to end.

---

## Review of 8bfa609 — docs(fulfilment): Stage 1 — all-brand pick, partial → backorder, punch

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Document Stage 1 in `order-lifecycle.md` + `godown-fulfilment-design.md`. Docs-only (verified — no non-doc file in the diff).

**What works:** The prose matches what I verified by execution at 34b73d4/072e423 — all-brand → `approved`, the removed `pending_approval→ready_to_bill` edge, brand-aware + partial pick, `submit_pick` ships picked qty → `ready_to_bill` with `total = Σ picked×price`, split → new `backorder` child (same salesman, `parent_order_id`, fresh gapless `order_no`), the `backorder` status before `pending_approval`, `punch_order`, immutable snapshots + additive `picked_qty` + `total_paise` = shipped, the kept "Pending scan" label, the `backordered`/`picked` events, all-brand godown RLS, Stage 2 parked. The lifecycle ASCII diagram is accurate. **No drift.**

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** Doc-accuracy only — reconciled every claim against the two verified code/DB reviews above.

**What I tried:** Diffed the two doc additions against the behavior proven in the 34b73d4 + 072e423 reviews.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** Stage 1 is complete + verified (backend + surfaces + docs). Merge-ready; an owner phone test (partial pick → backorder → punch) is the natural gate before Stage 2 unparks.

---

## Review of 1c0ef42 — fix(fulfilment): order-detail self-ref embed + backorder child genesis event

**Verdict:** ✅ accept — fixes a runtime bug that 072e423 shipped (and I missed).

**Phase / commit goal (as I understood it):** Two LAN-preview fixes. (1) The `parent_order` self-ref embed in `ORDER_DETAIL_SELECT` hinted the **constraint name** (`orders!orders_parent_order_id_fkey`), which PostgREST can't resolve for a self-FK → **PGRST200 broke EVERY order-detail page**; corrected to the **column hint** `orders!parent_order_id`. (2) `submit_pick` now logs a genesis event on the backorder **child** so its history isn't blank until punched.

**Reviewer miss (own audit, logged for honesty — cf. ㉜🅐):** my 072e423 ✅ ran `npm run build` + read the embed string, but PGRST200 is a *runtime* PostgREST planner error a build can't catch, and I did not exercise a live order-detail query — so the broken embed shipped. Lesson: **verify PostgREST embeds with an actual query, not build+read.**

**What works (verified by execution):**
- **Embed fixed** (live PostgREST, anon key): OLD `orders!orders_parent_order_id_fkey` → **HTTP 400 `PGRST200`** (the bug); NEW `orders!parent_order_id` → **resolves** (HTTP 401 `permission denied for auth_profile_role` = anon RLS denial, NOT an embed error — an authenticated session passes). Planner now resolves the self-ref → detail pages render.
- **Child genesis event** (live rolled-back probe): a partial pick logs `backordered` on **both** sides — parent `{child_ref: ORD-ZEB-1065, child_order_id}` → "Backordered → …"; **child** `{parent_ref: ORD-GEN-1064, parent_order_id}` → "Backordered from …". `order-events.ts` branches on `parent_ref` vs `child_ref` correctly.
- Split logic in the recreated `submit_pick` is unchanged from 34b73d4 (child created, remainder correct — re-proven in the same probe). Migration `20260710190654_…` is standard 14-digit.

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** The message notes "existing test backorders backfilled separately" — that backfill is outside this commit's diff (a one-off data touch, not migration logic); fine, just flagged as un-reviewed data.

**Domain / correctness checks:** State machine + money + immutability unaffected (this is event-logging + a query-string fix; the split RPC body is byte-identical to the verified 34b73d4). RLS unaffected.

**What I tried:** curl of old vs new self-ref embed against live PostgREST (400/PGRST200 → resolves); live rolled-back genesis probe reading both parent + child `backordered` event details; read all three file diffs.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. Lesson logged (verify embeds by query).

**Next-commit suggestion:** Stage 1 is now runtime-clean. An owner phone pass on the deployed URL (open an order detail + a backorder detail; partial-pick → punch) closes it out.

---

## Review of 9b42cd1 — feat(orders): reorder status tabs — Backorder moved to end, pipeline order

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Cosmetic — reorder the `OrdersView` status-tab array to read in pipeline order (All · Pending approval · Pending scan · Ready to bill · Billed · Cancelled · Backorder), moving `backorder` from just-after-All to the end.

**What works (verified by inspection — a one-line render-order change):** the diff is a pure reorder of the tab-array literal. Same **7** `StatusFilter` members before and after (`all, backorder, pending_approval, approved, ready_to_bill, billed, cancelled`), none dropped/added — `backorder` just moves index 1 → 6. The `StatusFilter` union, `STATUS_LABEL`, and `tabCounts` are keyed `Record<StatusFilter, …>` maps (order-independent), so only the visual tab order changes. Commit message accurate, incl. "Dispatched omitted — no such status until Stage 2."

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None.

**Domain / correctness checks:** N/A — pure presentation; no state machine / money / RLS / immutable-snapshot surface touched. Cannot affect the build (identical union members).

**What I tried:** Read the one-line diff; confirmed a same-members reorder (7→7) and that labels/counts are keyed maps, not positional.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** —

---

## Review of 59f96c1 — feat(orders): strike un-picked units on the order page + pick-slip PDF

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** A partially-picked order no longer renders/prints as if fully shipped. Per line (driven by `order_items.picked_qty`): a short line shows the picked figure + the struck ordered qty ("2 3̶"); a zero-taken line struck grey italic with amount = **original** (not ₹0); shipped lines reconcile to `order.total_paise`. On both the detail view and the A5 PDF. Read-only (adds `picked_qty` to the PDF select; no schema).

**What works (verified — read + build):**
- **PDF 500 avoided by construction:** struck text uses the built-in **`Courier-Oblique` / `Helvetica-Oblique`** faces *directly*, NOT `fontStyle:"italic"` on a bold family (react-pdf's bold PostScript families have no italic axis → "could not resolve font" → route 500). Those are standard-14 fonts (no registration), so the render can't hit that error; the builder documented the exact failure + fix inline. [PickSlipPdf.tsx]
- **Detail strike coherent** (`OrderDetailView`): `zeroTaken = view && picked_qty===0` → whole row struck, amount = `rate×qty` (original, struck); a short line → picked figure + struck ordered qty, amount = `rate×picked_qty` (shipped); the total stays `order.totalPaise` (the DB shipped total). The un-struck (shipped) amounts reconcile to the total; struck lines read as visually excluded — standard invoice UX. Muted grey (#6b7580); red stays reserved for cancellations. Backorder HISTORY refs are now parent↔child links.
- `npm run build` clean (tsc + eslint).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** Verified the PDF path by **read + build, not a live render** — the DB was wiped to 0 orders for rollout, so there's no partial order to produce an actual %PDF from. The font approach is provably correct (standard oblique faces), but an owner spot-check of the **first real partial order's PDF** closes it 100%.

**Domain / correctness checks:** Money ✓ (total = DB shipped `total_paise`; amounts via `formatRupees`, paise). Immutable snapshots ✓ (reads `picked_qty`, writes nothing). No RLS / state-machine / schema surface touched.

**What I tried:** Read the PDF font/strike diff + the `OrderDetailView` qty/amount/total logic; `npm run build`.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** —

---

## Review of 3d44216 — docs(specs): cancel/edit permissions matrices + edit-window removal proposal

**Verdict:** ✅ accept (a PROPOSED doc — nothing built)

**Phase / commit goal (as I understood it):** Record the owner-approved cancel & edit permission matrices + the plan to drop the 2h salesman edit window (status-gated instead), touched surfaces, the reverse-cancel finding, reversibility. Explicitly **PROPOSED, not implemented.**

**What works (doc review):**
- Header clearly marks **"STATUS: PROPOSED — NOT IMPLEMENTED. Do not build from this yet."** ✓ — no code, nothing to execute.
- Part 1 (window removal) coherent: today = `pending_approval AND editable_until>now()`; proposed = status-only. Rationale (the window predates the universal admin-approval lifecycle) sound; **`editable_until` column RETAINED** (still written by `submit_order`) — matches the safe posture (stop reading it, don't drop). ✓
- Matches the owner-approved plan I reviewed with the owner; the two behavioural notes (salesman can edit a pending order indefinitely; accountant cancel/edit tightened to pending-only, non-pending → admin-only) are owner-accepted.

**Blocking issues:** None. **Non-blocking suggestions:** None — it's a proposal doc.

**Domain / correctness checks:** Doc-accuracy only.

**What I tried:** Read the doc; cross-checked against the owner-approved plan + the live cancel/edit behaviour.

**Open flags (cumulative):** No 🔴. Carried as above. **Watch when it ships:** verify each matrix cell (role×state) live; confirm no in-flight order is stranded by the new gates; confirm `editable_until` is retained, not dropped.

**Next-commit suggestion:** —

---

## Review of 15cd3f6 — feat(ui): route loading skeletons + nav-button spinners

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Phase-6 #1 — add `loading.tsx` to the 10 remaining routes (login skipped, static form) so a navigation shows a shape-matched skeleton INSTANTLY inside the shell instead of freezing; plus a spinner on the Scan + salesman-Edit nav buttons. Presentation-only.

**What works (verified — count + read + build):**
- **10 routes gained a `loading.tsx`** → **12 total** (was 2). Skeleton primitive (`ui/Skeleton`, shimmer + reduced-motion) + shared composites (OrderDetailSkeleton, PickSkeleton, ListSkeleton); salesman routes full-page, dashboard routes fill only the content area (chrome persists). Matches the prompt's route table.
- **Nav spinners done right:** a **dedicated `useTransition`** (`navPending`/`startNav`) with a **`navTarget` key** so that when Edit + Scan co-render (salesman), only the *tapped* button spins (`loading={navPending && navTarget===…}`) — exactly the "separate transition, only the tapped button" spec. [OrderDetailView L124-129, 466/514/529]
- **Presentation-only** — every changed file is `.tsx`/`.module.css`; no data/query/RPC/RLS/money surface. `npm run build` clean.

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** N/A — pure presentation (loading fallbacks + a button affordance).

**What I tried:** Counted `loading.tsx` (12); confirmed the dedicated-transition + `navTarget` spinner wiring; confirmed the diff is `.tsx`/`.css` only; `npm run build`.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** —

---

## Review of 4eafbe3 — feat(db): cancel/edit permission matrices + drop the 2h edit window

**Verdict:** ✅ accept (migration correct + verified) — **NOT yet applied to prod; the apply is the gated release step (see the pin).**

**Phase / commit goal (as I understood it):** Recreate 3 functions per the proposal — `guard` adds `backorder→cancelled`; `cancel_order` drops the `editable_until` timer (salesman own-pending, accountant pending-only, everything past → admin-only, reason for staff); `update_order_items` drops the timer (salesman & accountant pending-only, post-approval → admin-only + reason). `editable_until` retained (still written, no longer read).

**What works (verified — read + rolled-back per-cell probe + prod-unchanged check):**
- **SQL read-verified:** all 3 bodies match the proposal matrices; logic sound (guard's `backorder→cancelled` edge + the role branches).
- **My own rolled-back probe** — applied the exact new bodies in a txn, tested cells, rolled back (prod untouched): **7/7 changed/security cells PASS** — accountant-cancel-billed **DENY**; admin-cancel-backorder **ALLOW** (the new edge / the owner's "illegal transition" bug fixed); salesman-cancel-approved **DENY**; accountant-edit-approved **DENY**; admin-edit-approved no-reason **DENY** / with-reason **ALLOW**; and critically **salesman-edit-pending with `editable_until` 3h in the past → ALLOW** (proves the window is gone). Complements the builder's own 15/15.
- **Prod confirmed unchanged:** live `cancel_order`/`update_order_items` still carry the old `editable_until` window (migration NOT applied — matches the "gated apply" claim); re-checked after my probe → still old (my DDL rolled back). `editable_until` retained.

**Blocking issues (must fix in next commit):** None.

**🔴-adjacent PIN — release coordination (not a code defect):** **the app is LIVE** — 22 real orders since rollout (`order_no` 1001–1031: 2 `pending_approval` + 1 `backorder` + 10 `billed` + 9 `cancelled`), i.e. orders these matrices govern. The migration is **not applied**, but the frontend (c1e4c74) already assumes the NEW backend. **At release: apply this migration to the live DB at/before the c1e4c74 deploy** — else a salesman editing a >2h `pending_approval` order sees the button (new FE) but the old backend rejects it ("window passed"), plus admin/accountant cancel-past-approval mismatches. 13d97e2 documents this; pinning it as the one thing to get right.

**Domain / correctness checks:** State machine ✓ (guard edges verified). RLS/roles ✓ (role×state gates proven live, rolled back). Money/immutability untouched (permission gates only). Order numbering ✓ (`editable_until` retained not dropped; my probe consumed a few `nextval`s → harmless gaps per D1).

**What I tried:** Read all 3 bodies; `pg_get_functiondef` prod-unchanged check (before + after); a rolled-back txn applying the new bodies + 7 role×state probes into a temp table; live-orders census.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. **+ the apply-gate pin above.**

**Next-commit suggestion:** At apply (owner go-ahead): re-run the full cell matrix on the now-live functions + confirm the 2 live pending + 1 backorder aren't stranded.

---

## Review of c1e4c74 — feat(orders): remove edit window/countdown + align cancel/edit buttons to matrices

**Verdict:** ✅ accept (matches the matrices) — ships **with** the 4eafbe3 apply (see that pin).

**Phase / commit goal (as I understood it):** Frontend for the new model (Commits 2+3 combined): `editable = status==='pending_approval'` (no timer), remove the countdown everywhere (delete `formatCountdown`), align Cancel/Edit button visibility to the matrices.

**What works (verified — read + build):**
- **Window gone:** `editable = order.status === "pending_approval"` (no `editable_until` read); `salesmanActionable = own + pending`; `requiresReason = mode==='edit' && !editable` (admin after-lock). `formatCountdown` deleted from format.ts; countdown removed from order-status.ts + Confirmation/NewOrderFlow/new-order.
- **Buttons match the matrices:** EDIT → `isAdmin ? status!=='cancelled' : status==='pending_approval'` (admin any non-cancelled, accountant pending-only) + salesman own-pending; CANCEL → same shape. Reconciles to the cancel/edit matrices exactly.
- `npm run build` clean.

**Blocking issues:** None.

**Non-blocking suggestions:** `editable_until` is still *selected* in a few queries (page.tsx / dashboard/page.tsx `ORDERS_SELECT`, new-order resume-draft, `OrderDetailData`) but no longer read for gating — harmless leftover (matches "retain the column"); prune when convenient.

**⚠️ Release dependency:** this frontend assumes the 4eafbe3 backend is applied; it must NOT reach prod before the migration is applied, or live users hit frontend-allows-but-backend-rejects. Coordinated at deploy per the plan/docs.

**Domain / correctness checks:** Permission-*display* only; the server RPCs remain the enforcement (hiding a button is cosmetic). Build clean.

**What I tried:** Read the editable/button-gating diff + the countdown removals; grepped residual `editable_until`; `npm run build`.

**Open flags (cumulative):** No 🔴. Carried as above.

**Next-commit suggestion:** —

---

## Review of 13d97e2 — docs(specs): cancel/edit permissions shipped — sync lifecycle + roles specs

**Verdict:** ✅ accept

**Phase / commit goal (as I understood it):** Sync the specs to the new model (Commit 4): the cancel/edit matrices, the window removal, touched surfaces, PROPOSED→(code) shipped.

**What works (doc review):**
- The matrices match what I verified live (cancel: salesman own-pending / accountant pending / admin any; edit: salesman & accountant pending / admin any-post-approval + reason). Accurate.
- **Crucially it prominently flags "⚠️ NOT yet applied to prod / not yet deployed"** — the migration is committed but not run against the live DB; the apply is gated at merge/deploy so "the prod DB never diverges from the prod frontend," fully reversible. So the doc does **not** over-claim — it's honest about the apply-gate. ✓

**Blocking issues:** None. **Non-blocking suggestions:** None.

**Domain / correctness checks:** Doc-accuracy only — cross-checked the matrices + apply-status framing against the live verification and the 4eafbe3/c1e4c74 reviews.

**What I tried:** Read the doc diff; cross-checked matrices + the apply-status note.

**Open flags (cumulative):** No 🔴. Carried as above. The **apply-gate pin (4eafbe3)** is the live release item.

**Next-commit suggestion:** Apply the migration (owner go-ahead) alongside the frontend deploy, then re-verify the cells live.

---

## Update — cancel/edit permissions MERGED + APPLIED + live-verified (2026-07-11)

The reviewed `4eafbe3 / c1e4c74 / 13d97e2` were rebased onto `main` as **`ce5db56 / 4e5b053 / b3d5070`** — `git range-diff` shows all three `=` (byte-identical), so the ✅×3 verdicts carry over unchanged. The **migration is now APPLIED to prod** (live `cancel_order` / `update_order_items` carry the new bodies — no `editable_until`, the accountant "only an admin may cancel" gate present), and the apply was coordinated with the frontend merge → **no FE/BE mismatch window**. Re-verified on the **applied live functions** (rolled-back probe, test orders discarded): **5/5 cells PASS** — accountant-cancel-billed DENY, admin-cancel-backorder ALLOW, salesman-cancel-approved DENY, accountant-edit-approved DENY, salesman-edit-pending-past-window ALLOW. **The apply-gate pin from the 4eafbe3 review is CLOSED.**

---

## Review of 7e918a1 — feat(godown): "PAKKA?" confirm before a short pick

**Verdict:** ✅ accept — client-side short-pick confirm, exactly to prompt; full picks unaffected.

**Phase / commit goal (as I understood it):** A partial pick (`doneCount < totalQty`) opens a `BottomSheet` "PAKKA?" confirm on Submit instead of firing straight through; a full pick submits directly (no dialog). Client-side UX guard only — no backend/RPC/RLS change; `submit_pick`'s ≥1-unit gate + partial→backorder split untouched. Both `/godown/[id]` and `/scan/[id]`.

**What works (verified — read + tsc + eslint + build):**
- **Gate is exactly shortfall-driven:** new `onSubmitTap()` → `if (shortfall > 0) setConfirmShort(true); else void handleSubmit();`. `shortfall = totalQty - doneCount`, so the sheet opens iff `doneCount < totalQty` (short) and submits straight through when equal (full). The Submit button now calls `onSubmitTap` (was `handleSubmit`).
- **`shortfall` can never be negative → no missed full-pick path:** scan mode caps per line (`addScan`/`handleDecode` reject once `countFor >= line.qty`), qty mode caps via `Stepper max={line.qty}`, so `doneCount ≤ totalQty` always. Full pick ⇒ `shortfall===0` ⇒ direct submit. ✓
- **Sheet content verbatim per prompt:** heading `PAKKA?`; body `Aapne {doneCount}/{totalQty} items hi add kiye hai.`; confirm `Haan, submit karo` → `setConfirmShort(false)` + the **unchanged** `handleSubmit()` (server splits the backorder as today); cancel `Nahi` and scrim-tap both just `setConfirmShort(false)` — **pick intact, nothing submitted** (no mutation of `scans`/`picked`).
- **≥1-unit gate intact:** `canSubmit = doneCount >= 1` still gates `disabled={!canSubmit}`; `onSubmitTap` is only reachable via that button, so the sheet can't open at 0 → sheet range is `1 ≤ doneCount < totalQty`.
- **No double-submit:** `Button` sets `disabled={disabled || loading}`, so once `handleSubmit` flips `submitting=true` the Submit button is disabled; while the sheet is open the scrim covers the underlying button.
- **Both routes:** `/scan/[id]/page.tsx` and `/godown/[id]/page.tsx` both render `PickScreen` → the guard appears in both, LG (serials) and fixed (qty) alike (totals already mode-aware, no per-brand branch).
- `npx tsc --noEmit` exit 0; `npm run lint` (eslint) exit 0; `npm run build` exit 0 (both routes compile).

**Blocking issues (must fix in next commit):** None.

**Non-blocking suggestions:** None — minimal + correct; CSS uses the design tokens (`--font-structure`, `--text-header-size`, `--color-ink`), two equal `flex:1` buttons.

**Domain / correctness checks:** State machine / backend untouched (client guard only — `submit_pick` remains the authority for the ≥1 gate + the partial→backorder split). Money / immutability / RLS / order numbering N/A. Prices absent from the pick screen (unchanged).

**What I tried:** Read the full `PickScreen` (shortfall/doneCount/canSubmit derivation, `handleSubmit`, the new `onSubmitTap` + the sheet), `BottomSheet` (scrim-tap → onClose) and `Button` (loading ⇒ disabled) to rule out double-submit; confirmed both routes mount `PickScreen`; `npx tsc --noEmit`, `npm run lint`, `npm run build`.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨. (The cancel/edit apply-gate pin is CLOSED.)

**Next-commit suggestion:** —

---

## Review of 76c8ef9 — feat(godown): "PAKKA?" confirm before a short pick (MERGED variant = 7e918a1 + red-alert restyle)

**Verdict:** ✅ accept — this is the version that **merged to `main`** (parent `d418499`; `f05baf6 = 76c8ef9` byte-identical, two SHAs same content). It is **not** a byte-identical rebase of the earlier-reviewed `7e918a1` — `git range-diff 7e918a1 76c8ef9` shows a delta — so I re-reviewed the delta on the shipped code.

**The delta vs `7e918a1` (full `git diff` — presentational ONLY):**
- **PickScreen.tsx:** the sheet's title+body are now wrapped in a `confirmAlert` `<div>` with a `⚠️` `confirmIcon` `<span aria-hidden>`; the confirm button's `variant` changed **`primary` → `destructive-filled`**. **Nothing else changed** — `onSubmitTap` (the `shortfall > 0 ? open : submit` gate), `handleSubmit`, `canSubmit`, both `onClick` handlers, and the message text `Aapne {doneCount}/{totalQty} items hi add kiye hai.` are byte-identical to `7e918a1`.
- **pick.module.css:** `confirmAlert` (centered column), `confirmIcon` (64px glyph), `confirmTitle` now 48px/800/`--color-error` (was header-size/ink), `confirmBody` 19px/600, `confirmActions` buttons `min-height:56px`. Bigger, red, unmissable — the warehouse-emphasis the owner wanted.

**What works (verified — read + range-diff + tsc + eslint + build):**
- **All `7e918a1` correctness carries over unchanged** (gate is shortfall-driven; `shortfall` can't go negative → full pick submits with no dialog; ≥1 gate intact; Nahi/scrim leave the pick intact; Haan runs the unchanged `handleSubmit()` → server splits the backorder; no double-submit — `Button` disables on `loading`; both `/godown/[id]` + `/scan/[id]`). See the `7e918a1` block above; the diff confirms none of that logic moved.
- **New markup/CSS valid:** `--color-error` (`#b91c1c`) is a defined token; `destructive-filled` is a real `ButtonVariant`. `⚠️` is `aria-hidden` (decorative — correct, the heading carries the meaning).
- `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm run build` exit 0.

**Blocking issues:** None.

**Non-blocking observations (owner-eyeball, not defects):**
- The `--color-error` token comment says *"errors + Cancelled only — red is reserved"*; this alert now spends red on a **warning heading + a red confirm button**. Defensible (a short-submit is error-adjacent, and the whole point is to make it feel consequential), but it's a small widening of that reservation — flagging so the owner clocks it.
- The **red confirm** ("Haan, submit karo") with a **neutral cancel** ("Nahi") inverts the usual "red = the destructive/cancel action" convention. It reads as an intentional *"proceed with the risky short-submit anyway"* pattern (like a red "Delete anyway"), but worth a glance on-device that a rushed picker won't misread which button proceeds.

**Domain / correctness checks:** State machine / backend untouched (client guard only — `submit_pick` still the authority for the ≥1 gate + partial→backorder split). Money / immutability / RLS / order numbering N/A.

**What I tried:** `git range-diff 7e918a1 76c8ef9` + full `git diff` on both files (scoped the change to markup + one variant); confirmed `--color-error` token + `destructive-filled` variant exist; `npx tsc --noEmit`, `npm run lint`, `npm run build` on the shipped tree.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** —

---

## Review of f4d972f — feat(orders): admin comment on a held (pending_approval) order — red note

**Verdict:** ✅ accept — backend proven by live rolled-back probes (6/6), frontend gating correct, no regression to `approve_order`, no RLS change. Already merged to `main` + **applied to prod** (2 migrations).

**Phase / commit goal (as I understood it):** One overwritable, **admin-only** note on a `pending_approval` order (distinct from the salesman's `orders.notes`); shows as a **red note** on the detail + a **red ⚠ line** on the order card/row for **everyone** who can see the order; **never changes status**; empty **clears** it; logs a `commented` event. Builder addition beyond the prompt: `approve_order` now **clears** the note on approval.

**What works (verified — read + migration-diff + 6 live rolled-back role probes + tsc/build):**
- **Migrations correct.** `20260711160000` adds `orders.admin_comment` + `set_admin_comment` (SECURITY DEFINER): null-profile reject → **admin-only** (`v_role <> 'admin'` raise) → order-exists → **`pending_approval`-only** → `admin_comment = nullif(btrim(p_comment),'')` (empty clears) → insert `commented` event → **status untouched**. `20260711161000` recreates `approve_order`.
- **`approve_order` = NO regression.** `diff`'d the new body against the prior (fulfilment-stage1) body: the **only** functional change is `+ admin_comment = null` in the UPDATE. The admin-only gate, `pending_approval`-only guard, all-brands→`approved` routing, and the `approved` event are **byte-identical**. The `commented` event is retained in history (audit trail) even after the note is cleared.
- **Live rolled-back probes on prod (impersonated via jwt claims; whole txn `raise`d → rolled back, prod untouched): 6/6 PASS** — P1 admin-set → OK, `btrim`'d, **status stays `pending_approval`**, `commented` event logged; P2 accountant-set → **DENY**; P3 salesman-set → **DENY**; P4 admin-empty → **CLEAR** (`admin_comment=NULL`); P5 set-then-`approve_order` → `status='approved'` + `admin_comment=NULL` + **`commented` events retained in history**; P6 comment-on-approved (non-pending) → **DENY**.
- **Visibility rides the RLS'd row — no RLS change** (grep: 0 `policy`/`row level` in the migration). The salesman's existing own-orders SELECT returns the whole row incl. `admin_comment`; both `ORDERS_SELECT` and `ORDER_DETAIL_SELECT` now include it, so a salesman sees the red line on his **own** order — and only his own (unchanged scoping). By construction, not a new grant.
- **Frontend gating correct.** Detail: red **"Admin note"** box renders for **ALL roles** (`{order.adminComment && …}`, no role gate); the write box is gated `isStaff && isAdmin && order.status === 'pending_approval'` (textarea seeded from the current note, "Add note"/"Update note" → `setAdminComment` → `router.refresh()`, `variant="secondary"` so it doesn't steal the single filled-accent from Approve). List: red `⚠ {admin_comment}` in the mobile card + desktop row for **every** role, `--color-error`, `-webkit-line-clamp:2` / ellipsis so long notes don't break layout. `order-events` describes `commented` ("Comment by … : …" / "Comment cleared"). Types regenerated.
- `npx tsc --noEmit` exit 0; `npm run build` exit 0 (at `f4d972f`).

**Blocking issues:** None.

**Non-blocking observations (owner-eyeball, not defects):**
- **Approval clears the note** (builder addition beyond the prompt). Intended + correct — but note the UX consequence for the owner: once you **Approve**, the red note **disappears** from the card/detail (it only lived to explain *why it was held*). It's not lost — the `commented` text stays in the order **History**. Flagging so it isn't a surprise.
- Detail `commentDraft` is `useState`-seeded once from `order.adminComment`; after a `router.refresh()` it isn't re-synced from props — harmless here (the admin editing *is* the source of truth), just noting.

**Domain / correctness checks:** State machine untouched (comment never transitions; `approve_order` transition unchanged bar the field clear). Immutability/money N/A (one nullable text column + one admin RPC). RLS unchanged (note rides the row). Order numbering N/A.

**What I tried:** Read both migrations + all FE diffs; `diff`'d old vs new `approve_order` (delta = `admin_comment=null` only); a 6-probe rolled-back `DO` block on prod impersonating admin/accountant/salesman; grepped the migration for RLS changes (none); confirmed `adminComment` mapping, `commented` history string, red-token CSS; `tsc` + `build`.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** —

---

## Note — reviewer-authored fix 0a6ba8f (owner-directed, NOT independently reviewed)

At the owner's explicit instruction I patched a live UI bug directly: **`fix(orders): filter dropdown tracks the trigger on scroll (mobile)`** (`0a6ba8f`, on `main`, parent `f4d972f`). The mobile filter popover is `position:fixed` with a `top` computed once at open and only re-synced on `resize`, so scrolling froze it mid-screen over the list. Fix = re-run the position `sync()` on `scroll` too (rAF-throttled, `capture:true`), so the popover stays glued below the trigger and rides up/off with the page. Client-side only, one component; `tsc`/`lint`/`build` clean. **Self-authored — flagged here for the audit trail since I was both author and reviewer on this one** (owner chose the direct-patch path).

---

## Note — reviewer-authored change 6ebeea5 (owner-directed, NOT independently reviewed)

Owner-directed direct patch: **`feat(orders): share PDF with the retailer's name as the message`** (`6ebeea5`, on `main`, parent `faa5415`). The mobile Web-Share payload was `{ files:[file], title: orderRef }` — WhatsApp attached the order ref as the caption. Changed to `{ files:[file], title: retailerName, text: retailerName }` (both fields, since target apps surface different ones) and threaded a `retailerName` prop into `SharePdfButton` from `OrderDetailView`'s two call sites (`order.retailerName`, already in scope). The PDF **file is still named after the ref** (`${orderRef}.pdf`) — only the share caption changed. Desktop path (opens the PDF, no share text) unaffected. Client-side only, 2 files; `tsc`/`lint`/`build` clean. **Self-authored — flagged for the audit trail** (owner chose the direct-patch path again).

---

## Review of 4d15f71 — feat(new-order): pre-fill + seed manual (LG) default price into Quick Order

**Verdict:** ✅ accept — the client half of manual-default-price; correct, and the *safe* edit path. (`4d15f71 = 6846c7e` pre-rebase, `git range-diff =`.)

**Phase / commit goal:** A manual (LG) product's `products.price_paise` becomes an optional DEFAULT the client pre-fills + seeds into Quick Order, so an untouched manual line reads & bills at the default with no extra tap; typing overrides; fixed brands never seed.

**What works (verified — read + tsc + build):**
- **Effective price** = `entered ?? p.price_paise` where `entered = prices?.[id] ?? snapshotPrices?.[id]` → order is **typed/seeded → edit-snapshot → default**. So an untouched line shows/inputs the default, and **editing an existing order shows the snapshot** (snapshot beats default → a placed line isn't re-priced on the display). Only the *manual* `priceLabel`/`inputVal` gained the `?? p.price_paise`; **fixed label unchanged** (`pricesById[id] ?? p.price_paise` catalog path).
- **Seed-on-add** (`handleQtyChange`): seeds `prices[id] = p.price_paise` via `onChangePrice` **iff** `pricing_mode==='manual' && price_paise != null && prev===0 && next>=1 && prices[id]==null`. So it fires only when a manual line *first* enters the cart with a default and nothing typed — the line total, cart total, and submit payload then all carry the default. Wired into **both** the Stepper `onChange` and the keypad `onSet`.
- **Fixed never seeds** (guarded by `pricing_mode==='manual'`); **existing lines in an edit never seed** (they have `prev>=1`, so only a *newly added* line seeds — correct). Clearing the box drops the entry (`CHANGE_PRICE` deletes a `<=0` entry) → display falls back to default; the billed value then relies on the server fallback (7b17607).
- `tsc`/`build` clean.

**Blocking issues:** None. **Non-blocking:** after clearing the box the label shows the default while the input reads empty (buffered `""` wins) — cosmetic, consistent with "override cleared → default applies."

**Domain checks:** Money in paise throughout; immutability intact on THIS path (seed only touches a fresh line, snapshot wins for existing). The fixed untamperable path is untouched here (client price still ignored server-side).

**What I tried:** Read the full `handleQtyChange` + `effective`/`priceLabel`/`inputVal` change and the `NewOrderFlow` `CHANGE_PRICE` reducer (`>0` keeps, else `delete`) + `toItemsPayload` (sends `unit_price_paise` only when a price is set); `tsc`/`build`.

**Open flags (cumulative):** No 🔴. Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion:** — (paired with the server fallback 7b17607, reviewed below.)

---

## Review of 7b17607 — feat(db): manual-brand price falls back to product default (submit_order + update_order_items)

**Verdict:** ✅ accept the feature (works on every intended path; fixed untamperability intact; merged + applied to prod) — **BUT with a 🔴 BLOCKING-BEFORE-USE finding** the builder must fix *before any LG product is given a default*: the STAFF edit path silently re-prices existing manual lines. (`7b17607 = b396df1` pre-rebase, `git range-diff =`.)

**Phase / commit goal:** Server-side belt-and-suspenders for the manual default — if a manual line arrives without a price, fall back to the product default. Migration `20260711172707` recreates `submit_order` + `update_order_items`; the ONLY logic change is the manual-branch coalesce (verified below).

**Change is surgical — confirmed by normalized diff vs the prior defs:**
- `submit_order` (prior = lifecycle `20260709200230`): only `v_unit_price := (…)::int` → `coalesce((…)::int, v_product.price_paise)`. `v_product` is loaded before the branch → correct default. Everything else = comment/whitespace only.
- `update_order_items` (prior = cancel_edit `20260711153000`): only `v_unit_price := (…)::int` → `coalesce((…)::int, (select price_paise from products where id = v_product_id))` — a scoped subquery because `v_product` isn't loaded at the top-of-loop validation (sound). Everything else = comment/whitespace only. Role gates / brand guard / before-after audit / delete-removed / fixed branch all unchanged.

**Live rolled-back money-path probes on prod (impersonated; whole txn rolled back — an LG default was set only inside the txn):**
- **P1** manual, no client price → **`500000` (default)** ✅
- **P2** manual override `300000` → **`300000`** ✅
- **P3** manual, NO default, no price → **REJECT** ("invalid manual price") ✅ (validation `>0`/ceiling/reject-if-null intact)
- **P4** fixed, forged client price `1` → **`1569400` (catalog)** ✅ — **untamperable path NOT regressed**
- **P5a** placed manual override `300000` (product default `500000`) → **`300000`** ✅
- **P7** salesman-path edit that SENDS the snapshot (`300000`) → **`300000` preserved** ✅ (the QuickOrder path is safe — it always sends the price)

**🔴 BLOCKING-BEFORE-USE finding — staff edit silently re-prices manual snapshots (P5b):**
- **P5b:** the SAME overridden order (`300000`), edited via the **STAFF path** — `OrderDetailView` inline editor, which calls `updateOrderItems(id, notes, items, reason)` **without the `prices` arg** ([OrderDetailView.tsx:310](src/components/orders/OrderDetailView.tsx#L310)), so `toItemsPayload` emits `{product_id, qty}` with **no `unit_price_paise`** for every line — resulted in the existing line being **RE-PRICED to `500000` (the current default), destroying the salesman's `300000` deal.** Proven live.
- **Why:** for an *existing* manual line the new code does `unit_price_paise = coalesce(client_price, current_default)` — it falls back to the **current product default, not the line's existing snapshot**. The prompt's own acceptance ("editing an existing manual order doesn't re-price existing lines — snapshot wins over default") is **violated on the staff path**. The salesman path passes only because QuickOrder happens to resend the snapshot.
- **Severity / reachability:** it's an **immutable-snapshot + money-integrity** violation and admin edits reach it on **any** status (incl. `edited_after_lock` on a `billed` LG order). It is **DORMANT today** — every LG product's default is currently NULL, so this path `coalesce(null,null)=null` → REJECTs (same loud error as before the migration). It **activates the instant an LG product is given a default** — i.e. the moment the feature is actually used — turning a safe "edit fails" into silent price corruption.
- **Fix (server, preferred — defense-in-depth):** for an **existing** manual line, prefer the line's own snapshot before the default, e.g. `coalesce(client_price, <existing order_items.unit_price_paise for this line>, product_default)`; a **new** manual line (no existing row) still falls to the default. Equivalently: only overwrite `unit_price_paise` when a client price is actually supplied — mirror the fixed branch, which already leaves the snapshot untouched. (Complementary FE fix: have `OrderDetailView` pass snapshot `prices` into `updateOrderItems` like QuickOrder does.)

**Domain checks:** State machine untouched. Money math verified live (paise, coalesce, ceiling/`>0`). Immutability: **held on submit + salesman-edit + fixed; VIOLATED on staff-edit of manual (the finding).** Fixed untamperability proven (P4). Order numbering: probes consumed a few `order_no_seq` nextvals (non-transactional → harmless gaps, D1).

**What I tried:** Read the full migration + traced both functions; normalized diff vs the two prior defs (only the coalesce differs); 7 live rolled-back probes incl. the staff-vs-salesman edit contrast; `tsc`/`build`.

**Open flags (cumulative):** No standing 🔴, **+ this new 🔴-before-use (staff-edit manual re-price).** Carried 🟡 ㊷, ㉛, ⑯ ⑬ ⑭ ⑦ ⑧ ⑨.

**Next-commit suggestion (BLOCKING before any LG default is set):** make the existing-manual-line branch keep its snapshot when the client sends no price (server `coalesce(client, existing_snapshot, default)`), then re-run P5b → expect `300000` preserved. Until then, **do not set a default on any LG product.**

---
