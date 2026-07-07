# Phase 3 — Multi-brand: design note

**Status:** design captured 2026-07-07, **not built.** Phase 3 in [PLAN.md](../PLAN.md). When implemented this **revises D4's "order refs carry no brand code"** — record a decision in [decisions.md](decisions.md) at that time.

## Premise (what's already true)

- The schema was built **multi-brand-ready** (D4): a `brands` table exists (seeded `Zebronics`), and **every `products` row already carries `brand_id`**. Multi-brand is *additive*, not a rewrite.
- **Invariant: one order = exactly one brand.** A salesman may sell several brands, but on **separate visit rounds** (D4) — a mixed-brand order never happens.
- **No per-salesman brand restriction** and no `salesman↔brand` table — the brand is chosen per order/round.

## The one real schema change: brand as a first-class order attribute

Today an order's brand is only *derivable* from its items (D4's Phase-1 stance). For real multi-brand, make it explicit:

- **`orders.brand_id uuid not null references public.brands(id)`** — set at submit (backfill existing rows → Zebronics in the migration).
- **`submit_order` guard:** every line's `product.brand_id` must equal `orders.brand_id` → a mixed-brand order is **rejected server-side** (enforces the invariant, not just the UI). `update_order_items` likewise can't introduce a foreign-brand line.

## Order refs — add a brand code

Add **`brands.code text unique`** (short stable token, e.g. `ZEB`, `LG`). Then two numbering options:

### Option A — one global sequence, brand code is context **(recommended)**
`ORD-<CODE>-<IST year>-<order_no>` → `ORD-ZEB-2026-1042`, next order `ORD-LG-2026-1043`.
- Keep the single `order_no_seq`; `order_no` stays **globally unique + monotonic** (gaps fine — D1).
- **No per-brand counters.** The number alone identifies an order across all brands — safest for a ref that gets spoken or printed on a pick slip.
- Change surface: just the ref-string format (prepend `code`) + `orders.brand_id`.

### Option B — per-brand numbering
`ORD-ZEB-2026-1001`, `ORD-LG-2026-1001` (each brand counts from its own 1001).
- Requires `unique(brand_id, order_no)` (not global-unique) **plus a sequence-per-brand or a counter table** — reintroducing exactly the per-brand-counter bookkeeping **D1 deliberately avoided** (and each new brand needs its own sequence). "Order 1001" then needs the brand to disambiguate.

**Year:** cosmetic; the number does **not** reset annually (D1) — keep it that way. A per-year reset would be a third axis (per-brand-per-year) — avoid it.

**Recommendation: Option A.** Owner to confirm A vs B before build.

## Pricing mode per brand — Zebronics `fixed`, LG `manual` (owner, 2026-07-07)

Zebronics is catalog-priced; **LG requires the salesman to enter the price per line** — **no fixed price list, no reference/MRP to pre-fill, no floor/min** (owner-confirmed). That breaks the current invariant ("client never sends a price; the RPC snapshots from the catalog"), so pricing becomes a **per-brand mode**:

- **`fixed`** (Zebronics, default): the RPC snapshots `unit_price_paise` from the catalog; any client-sent price is ignored — today's behavior, untamperable.
- **`manual`** (LG): the salesman enters the unit price per line (blank entry); that price *is* the price. `submit_order` / `update_order_items` **accept the client price for manual-brand lines**, validate `> 0` (a fat-finger sanity ceiling only — **no floor**), snapshot it into `order_items.unit_price_paise`, and audit who entered it in `order_events`. The trust boundary relaxes **only** for manual brands; Zebronics keeps its can't-be-tampered guarantee.

Carry the flag as `brands.pricing_mode text not null default 'fixed' check (pricing_mode in ('fixed','manual'))`. `order_items.unit_price_paise` already works for both — only the *source* differs.

### Approval gate — manual-priced orders need admin sign-off
A **manual-priced (LG) order must be approved by the admin before it can be processed** (booked into Tally). Owner specified **admin**, not accountant. Model it as **two new statuses**, not one:
- **`pending_approval`** — where a `requires_approval` brand's order lands at submit (Zebronics skips straight to `submitted` as today). Salesman-editable within the 2h window, derived-locked after — behaves like `submitted`.
- **`approved`** — admin has signed off; salesman read-only; only now can the accountant `process_order` it — behaves like `processed` for the salesman.

⚠️ The live `orders.status` CHECK is only `('submitted','processed','cancelled')` — adding both is a **real migration**, not the "status headroom" PLAN Phase 5 implies.

Wiring:
- Drive it off a brand flag **`brands.requires_approval boolean not null default false`** (kept separate from `pricing_mode` — for LG they coincide, but they're independent concepts). `submit_order` sets the initial status from it.
- New **admin-only `approve_order` RPC** (`v_role = 'admin'`): `pending_approval → approved`, stamp `approved_at`/`approved_by`, log event `approved`. Approval **beats the timer** — it locks the salesman out immediately, exactly as `process_order` already does.
- `process_order` accepts `submitted` (fixed brands) **or** `approved` (approval brands); it rejects `pending_approval` ("must be approved first").
- Dashboard gets a **Pending approval** filter/tab (admin acts there). Additive columns: `orders.approved_at timestamptz`, `orders.approved_by uuid references profiles(id)`.
- **Reject** is *not* a separate state at launch: an admin who won't approve **cancels with a reason** (existing accountant/admin path) and the salesman re-submits. Add a keep-the-row reject/return loop only if it's actually wanted.

### Relationship to Phase 5
Phase 5 was *tiered discounts off a list price, no free-typing*. LG is the opposite — free manual entry, no tiers, no floor — gated by **admin approval** instead of a discount-floor rule. They can coexist later (fixed+tiered for some brands, manual+approval for others).

### Resolved (2026-07-07, owner discussion)
- Salesman **can** edit a `pending_approval` order (and sees a **Pending approval** chip) within the normal 2h window. ✅
- The 2h window **applies**, and **approval beats it** — approving locks the salesman out immediately, like processing. ✅
- **Reject** = cancel-with-reason (no separate status); the approval event name is `approved`. ✅
- Approve moves to a distinct **`approved`** state (not back to `submitted`), so an approved LG order is never confused with a fresh Zebronics one and can't be re-edited. ✅

## What does NOT change

`order_items`/snapshots, the RPC-only write model, the RLS matrix, money (integer paise), the lifecycle/states and edit window — **for the brand/ref change** above. (The LG **`manual` pricing mode** *does* touch the RPC's price source and adds the `pending_approval` + `approved` states — see that section.) Adding a brand at runtime = **new CSV in `data/` + a `brands` row (+`code`) + brand-prefixed SKUs** — data, per D4 and [seed-data.md](specs/seed-data.md).

## Salesman brand selection — lazy constraint, not an upfront gate (owner, 2026-07-07)
**No brand picker at order start** — front-loading the choice constrains before the salesman has committed and fights the notebook-beating speed rule. Brand selection lives **inside Quick Order (S4)**, next to the search:
- **A compact brand dropdown beside the search bar** (shrink the search to fit) — a **plain OS `<select>`, tap-to-pick, NOT typable** (unlike the M5.5 admin category typeahead — different context). Default **"All brands"**.
- **Brand = a "hyper-category" grouping, NOT a per-item tag** (the rows are already congested). In "All brands" the catalog nests **Brand ▸ Category ▸ items** — a bigger **Zebronics** section wrapping its `Adaptors` / `Speakers` / … sub-sections, then a **Luminous** section, etc. (This also fixes same-named categories across brands colliding — each lives under its own brand.) **Both tiers are sticky on scroll (nested):** the brand header pins at the top with a **heavier/distinct treatment above** the navy category bars, and the category bar's live-measured sticky `top` must now **account for the brand-header height** (two-tier sticky — the fiddly part).
- **Pick a brand ⇒ filter** to it (browsing aid; cart empty, nothing locked). With one brand showing, the brand hyper-section collapses to just its categories (the brand is already named in the dropdown).
- **Add the first item (any qty) ⇒ brand auto-locks** to that item's brand: the dropdown snaps to it and **disables** (can't clear/change while the cart holds items), the list filters to that brand (single-brand ⇒ categories only). A subtle cue explains why the list narrowed.
- **Empty the cart ⇒ brand unlocks.**
- Enforces **one-brand-per-order** as a pleasant front-end, but the **server `submit_order` brand-guard stays the real wall** (UI reflects the rule; the RPC enforces it). `orders.brand_id` = the locked brand; the ref carries its **brand code** (Option A).
- Only **active brands with ≥1 priced product** appear (no empty selections). Mobile: a native `<select>` at 2–5 brands; mind the search-bar shrink on narrow phones.

## Build scope when Phase 3 lands

1. **One migration:** `orders.brand_id` (+ backfill → Zebronics), `brands.code`, the `submit_order`/`update_order_items` brand-guard, and the new ref format in `submit_order`.
2. **Seed** the new brand (CSV + brand row + SKU prefix).
3. **UI:** the **in-Quick-Order brand dropdown + lazy auto-lock** (see "Salesman brand selection" above), **not** an order-start picker; dashboard brand filter/column; brand in the pick-slip header.
4. **Update D4** in decisions.md (ref format flips to brand-coded; record the A-vs-B choice).

## Open decision

- **Ref numbering: A (global sequence + brand code) [recommended] vs B (per-brand numbering).** Owner: pending.
