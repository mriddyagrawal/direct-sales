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

## D8 — A salesman's own order list hides self-cancelled orders by default

**Context.** `cancel_order` is soft by design (data-model.md) — the row and its audit trail always survive, and the accountant/admin dashboard always sees everything (SELECT all, per the RLS matrix). But when the *owning salesman* cancels within the edit window, it's almost always a fat-fingered mistake ("wrong shop", "hit submit too early"), not a business event they need to keep seeing in their own history.

**Decision.** The salesman's own order list ([salesman-app.md](specs/salesman-app.md)) excludes `status = 'cancelled'` orders by default — a self-cancel reads as "never happened" from the salesman's point of view. This is a client-query filter, not an RLS or schema change: the underlying row, event trail, and the accountant's full visibility are untouched. Whether a dedicated "Cancelled orders" view ever exposes these rows back to the salesman is unscheduled (see [future-plans.md](future-plans.md)).

**Consequences.** No migration needed — `orders.status`, `cancel_order`, and the salesman-own `SELECT` policy built in M1 already support this exactly as-is. Purely a query-shape decision for the (not-yet-scaffolded) order-list screen.

---

# Graveyard — rejected ideas (do not re-litigate)

- **"Gapless" numbering via SEQUENCE** — not a real thing (see D1); and not needed once refs are internal.
- **Browser pushes XML to Tally at `localhost:9000` (old "Path B")** — dead end: Tally's XML server speaks no CORS (it will never answer a preflight), Chrome's Private Network Access rules require exactly that preflight for public-site→localhost requests, and Safari additionally blocks it as mixed content. The real Phase 2 paths are file export/import and a local sync agent. 
- **Per-brand subdomains** (`zebronics.ganpati.com`) — multi-tenant machinery for a 100-SKU, 4-person operation; a brand column and a filter do the same job (D4).
- **Amazon-style catalog UI** — discovery-oriented B2C pattern; wrong model for a salesman who knows the catalog and is racing a shopkeeper's dictation. The Quick Order list stands.
- **SQLite + local hosting** — no story for field access, auth, or realtime; was never a real contender against a managed Postgres.
- **LOCKED as a stored status** — early drafts modeled DRAFT→SUBMITTED→LOCKED. Corrected: *locked is a derived condition* (past `editable_until`, or status `processed`), not a state something transitions into. See [specs/order-lifecycle.md](specs/order-lifecycle.md). The `comments.md` standing checklist predates this correction.
