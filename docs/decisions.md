# Decision Log

Decisions confirmed with the owner on **2026-07-06**. Each entry: context → decision → consequences. Specs and code must conform; if a decision changes, update it here first.

## D1 — Order numbers are internal references; gaps are acceptable

**Context.** The original draft claimed "gapless numbering via PostgreSQL SEQUENCE". That claim is factually wrong — sequences are non-transactional and rolled-back inserts burn numbers, so sequences guarantee uniqueness and monotonicity, *never* gaplessness. Truly gapless numbering requires a locked counter table and matters only when the numbers are statutory invoice numbers.

**Decision.** App order numbers are **internal references** (`ORD-2026-1042`) from a plain Postgres sequence, assigned at **submit** (drafts are unnumbered, which also minimizes gaps). **Tally remains the statutory system of record** and assigns real invoice numbers when the accountant books the order.

**Consequences.** No counter-table locking; simpler submit path. A gap in refs is not a defect — the REVIEWER's original checklist item "gapless sequence" in `comments.md` predates this decision (the REVIEWER has since amended it).

## D2 — Unpriced ("TBD") products are hidden until priced

**Context.** 8 of 42 CSV SKUs have price "TBD". Options were: hide, show-but-block, or orderable at ₹0.

**Decision.** `price_paise IS NULL` ⇒ the product is **invisible to salesmen** (enforced in RLS, not just UI filtering). Accountant/admin see unpriced rows and can set prices, which makes them appear.

**Consequences.** No ₹0 orders, no "price pending" UI states in Phase 1. Seed maps `TBD` → `NULL`.

## D3 — Supabase Auth, admin-created email+password accounts

**Context.** A 3–4 person userbase needs zero-ceremony auth; SMS OTP adds provider cost and setup for no benefit at this scale.

**Decision.** Supabase email+password. **No self-signup** — the admin creates each account; a `profiles` row carries the role (`admin` / `accountant` / `salesman`).

**Consequences.** No signup/verification flows to build or design. Password resets handled by the admin initially.

## D4 — Single-brand Phase 1 is safe; multi-brand is Phase 3

**Context.** If salesmen took mixed-brand orders in one shop visit, a Zebronics-only app would force them to carry the notebook anyway — killing adoption. Checked with the owner.

**Decision.** Brands are sold on **separate visit rounds**, so Zebronics-only Phase 1 fully covers a Zebronics round. Multi-brand lands in Phase 3 (schema supports it from day one via the `brands` table).

**Consequences.** No brand switcher in Phase 1 UI. Order refs carry **no brand code** (an order's brand is a property of its items, not its identity).

## D5 — CSV prices are GST-inclusive retailer billing rates

**Context.** Whether prices were ex-GST or inclusive changes every displayed total and the Phase 2 Tally mapping.

**Decision.** The price list holds the **actual amount billed to the retailer, GST included**. App totals therefore equal invoice totals; the app performs **no tax math**.

**Consequences.** Phase 2 XML must mark rates as tax-inclusive (Tally supports inclusive-of-tax rates); the accountant's Tally setup owns the tax breakup.

## D6 — Design target: 1–2 salesmen, <20 orders/day

**Context.** Architecture sized to reality, not aspiration.

**Decision.** Optimize for field speed and simplicity. Free/low tiers suffice; realtime-vs-polling and similar choices are "either is fine"; the pilot *is* the rollout.

**Consequences.** No perf engineering beyond snappy-list basics; no queueing; concurrency edge cases handled by Postgres defaults + one idempotency key.

## D7 — Deliberate custom build

**Context.** Off-the-shelf DMS/SFA SaaS (Bizom, FieldAssist, SalesDiary; Zoho+Tally connectors) covers this category at per-user/month pricing.

**Decision.** Build custom: exact workflow fit (order-not-invoice capture, grace-window edits, per-brand rounds, Tally sales-order import), near-zero running cost at this scale, full data/control ownership, and the owner wants to own and extend it.

**Consequences.** We accept building/maintaining auth, catalog, and dashboards ourselves; the honest alternative is recorded here so it never has to be re-litigated.

## D8 — A salesman's own order list hides *self*-cancelled orders by default

**Context.** `cancel_order` is soft by design (data-model.md) — the row and its audit trail always survive, and the accountant/admin dashboard always sees everything (SELECT all, per the RLS matrix). When the *owning salesman* cancels within the edit window, it's almost always a fat-fingered mistake ("wrong shop", "hit submit too early"), not a business event they need to keep seeing in their own history. **Correction (2026-07-07, REVIEWER flag ⑮ on the first pass of this decision):** `cancel_order` also lets the accountant/admin cancel a salesman's order — e.g. the retailer phoned in and backed out. That's real news the salesman must still see; a blanket `status = 'cancelled'` filter would make it vanish silently, risking a confused duplicate re-submit. The rationale ("this reads as never having happened") only holds for a *self*-cancel.

**Decision.** The salesman's own order list ([salesman-app.md](specs/salesman-app.md)) hides an order only when **both** `status = 'cancelled'` **and** `cancelled_by = salesman_id` (added as an `orders` column, mirroring `processed_by`, in M1.9) — i.e. only orders the salesman cancelled *themselves*. An office-cancelled order (`cancelled_by` is the accountant/admin's id, not the salesman's) stays visible in their list, presumably with a chip/label making clear the office killed it (exact treatment is an M4 UI decision, not specced here). This is still a client-query filter, not an RLS change: the underlying row, event trail, and the accountant's full visibility are untouched. Whether a dedicated "Cancelled orders" view ever exposes self-cancelled rows back to the salesman is unscheduled (see [future-plans.md](future-plans.md)).

**Consequences.** One additive migration was needed after all (M1.9: `orders.cancelled_by uuid references profiles(id)`, set by `cancel_order`) — the original "no migration needed" claim undersold the design gap the REVIEWER caught. `orders.status`, `cancelled_by`, `cancel_order`, and the salesman-own `SELECT` policy now fully support the corrected filter. Still purely a query-shape decision for the (not-yet-scaffolded) order-list screen — no RLS/grant change.

---

## D9 — Login by username; registration stays email+password

**Context.** D3 fixed email+password, admin-created accounts (no self-signup) — that stays true for *registration*: the admin still creates each `auth.users` row with a real email (needed for any future password-reset/notification use). But the owner wants staff to *log in* with a separately-chosen username, not their email — and explicitly ruled out the shortcut of deriving it from the email's local-part (the pattern the owner's other project, `QuoteIt`, uses: a synthetic `username@quoteit.app` auth email with the username being everything before the `@`). That pattern conflates identity with the auth email and can't carry a real email at all — not what's wanted here.

Supabase Auth has no native "log in by arbitrary field" — it authenticates by email or phone only. Community guidance (a Supabase GitHub discussion, checked before implementing) is explicit about the naive fix: a client-callable "get email for this username" endpoint exposes emails to the browser and can be scripted to harvest them by enumerating usernames.

**Decision.**
- `profiles.username` (new column, `citext` — case-insensitive, so "Raju"/"raju" collide correctly) — nullable + unique, freely chosen by the admin at account-creation time via Supabase Auth's user-metadata field (`{"username": "raju1"}` in the Dashboard "Add user" form), picked up by `create_profile_for_new_user`. Never derived from the email.
- `public.email_for_username(p_username citext) returns text` — `security definer`, search_path pinned. Returns only an email string, only for an **active** profile (a deactivated account's email is never handed back — same fail-closed shape as everywhere else), nothing else about the profile is exposed.
- **The lookup + sign-in run together in a single Next.js Server Action** (`src/app/login/actions.ts`), not from the browser's Supabase client. Same generic "Wrong username or password" message whether the username doesn't exist, is deactivated, or the password is wrong.

**Correction (2026-07-07, REVIEWER flag ㉑, proven live).** The first pass granted `email_for_username` to `anon` (and `authenticated`) and claimed "calling it from a Server Action is what closes the enumeration/harvesting risk" and "the RPC being anon-callable is unavoidable." **Both statements were wrong.** The REVIEWER called the function directly *as the `anon` role* — `select email_for_username('mridul')` — and got back the real email, entirely bypassing the Server Action: the public anon/publishable key ships in the client bundle by design, so anyone holding it can POST straight to `/rest/v1/rpc/email_for_username`, regardless of what the app's own UI does. *How* the app calls an endpoint is irrelevant when the endpoint's own grant makes it callable from outside the app. Fixed: `email_for_username` now has **no grant to `anon` or `authenticated` at all** — only a server-only client authenticated with `SUPABASE_SECRET_KEY` (`src/lib/supabase/service.ts`, guarded by the `server-only` package so an accidental client-bundle import is a build error, not a runtime leak) can call it. This is the only RPC in the project that needs the secret key; every other write path stays RPC-only via `authenticated`-granted security-definer functions as before.

**Consequences.** Two migrations (`profiles.username` + the RPC + the trigger update; then the `service_role`-only grant fix). No RLS policy changes (the RPC bypasses RLS by design, same as every other security-definer function in this project). `SUPABASE_SECRET_KEY` (a new-style `sb_secret_...` key — the replacement for the legacy `service_role` JWT, which a `sb_secret_...` key still authenticates against Postgres as) is now a required server-side env var (`.env.example` documents it; the real value must come from the owner via the Supabase Dashboard — no MCP tool exposes it, same class of limitation as creating auth users). The login screen's field label changes from EMAIL to USERNAME (design/phase1-design-spec.md, docs/specs/salesman-app.md updated in the same commit). The 3 existing test accounts were backfilled with usernames (`vikram`, `mriddy`, `mridul`) — see docs/m1-test-accounts.md.

---

## D10 — Order history shows real staff names to the salesman

**Context.** The S7 order-detail HISTORY (and the dashboard S9 timeline) humanize `order_events` with the actor's `full_name` ("Edited after lock 14:20 by Vikram — TT27 qty 5→10, reason: shop called"), falling back to "the office" only when no name resolves. `profiles_select_active` (M1) already lets any active staff read the profiles directory, so a salesman *can* see who touched their order. REVIEWER flag ㉗(b) asked whether surfacing real staff names to salesmen is intended, or should be a generic "the office".

**Decision.** Show **real staff names** (owner-confirmed 2026-07-07). At a 3–4 person family-run operation everyone already knows everyone; a name is more useful and more honest than "the office" ("Vikram edited this" tells the salesman exactly who to call). No code change — this is the current behavior; ㉗(b) closes as intended.

**Consequences.** None new; `profiles_select_active` stays as is. If the team ever grows to where staff anonymity matters, revisit (tighten the profiles read policy + fall back to role labels).

---

## D11 — Admin/accountant stay functionally identical in-app; oversight-only is a convention, not an enforced permission

**Context.** The owner asked for a permissions overview across salesman/accountant/admin, framing admin's intended purpose as "oversee, and help in extreme cases" rather than day-to-day operation. Checking the actual RPCs (`submit_order`, `update_order_items`, `cancel_order`, `process_order`) showed every role check branches on `v_role in ('accountant', 'admin')` — no admin-only RPC path exists, and the dashboard UI/nav doesn't differentiate the two roles at all.

**Correction (REVIEWER, same-day, twice).** The first pass claimed the RLS layer had exactly one admin-only policy (`products_admin_insert`) — undercounted. A live `pg_policies` query turned up **four**: `profiles_update_admin` (UPDATE any profile — accountant has no UPDATE policy on `profiles` at all), `brands_admin_insert` and `brands_admin_update` (accountant is SELECT-only on `brands`), and `products_admin_insert` (accountant can only UPDATE existing products, not insert new ones). See the table in [roles-and-permissions.md](specs/roles-and-permissions.md) for the full breakdown. All four are dormant — no in-app screen exercises any of them; profile-role changes and brand/product-catalog additions happen by hand in Supabase Studio today, per the provisioning runbook.

**Decision.** Leave it as is (owner-confirmed 2026-07-07). Admin and accountant keep effectively identical *in-app* permissions — the four latent RLS-level exceptions aren't reachable from any screen today. "Admin is for oversight/escalation, accountant runs the queue" remains a role the owner chooses to play, not something the system enforces — nothing technical stops an admin account from doing full-time accountant work, and no UI cue distinguishes the two.

**Consequences.** No code change. If a real enforced split is ever wanted (e.g., admin's view emphasizes exceptions/audit rather than the live queue, or accountant loses some capability admin keeps), that's a future product decision — this entry records that the gap was noticed and deliberately left alone, so it isn't rediscovered as a bug later.

---

# Graveyard — rejected ideas (do not re-litigate)

- **"Gapless" numbering via SEQUENCE** — not a real thing (see D1); and not needed once refs are internal.
- **Browser pushes XML to Tally at `localhost:9000` (old "Path B")** — dead end: Tally's XML server speaks no CORS (it will never answer a preflight), Chrome's Private Network Access rules require exactly that preflight for public-site→localhost requests, and Safari additionally blocks it as mixed content. The real Phase 2 paths are file export/import and a local sync agent. 
- **Per-brand subdomains** (`zebronics.ganpati.com`) — multi-tenant machinery for a 100-SKU, 4-person operation; a brand column and a filter do the same job (D4).
- **Amazon-style catalog UI** — discovery-oriented B2C pattern; wrong model for a salesman who knows the catalog and is racing a shopkeeper's dictation. The Quick Order list stands.
- **SQLite + local hosting** — no story for field access, auth, or realtime; was never a real contender against a managed Postgres.
- **LOCKED as a stored status** — early drafts modeled DRAFT→SUBMITTED→LOCKED. Corrected: *locked is a derived condition* (past `editable_until`, or status `processed`), not a state something transitions into. See [specs/order-lifecycle.md](specs/order-lifecycle.md). The `comments.md` standing checklist predates this correction.
- **Synthetic per-username auth email** (`username@yourapp.local`, the pattern the owner's `QuoteIt` project uses) — rejected for username login (D9): it makes the username just the email's local-part reconstructed, which the owner explicitly ruled out, and the auth email stops being a real, reachable address.
