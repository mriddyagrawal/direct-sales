# Builder prompt — Phase 3b: LG manual pricing + admin approval + Quick Order collapse revamp

## What this is
Enable **manual-pricing brands** (LG) — the salesman types the unit price per line (no catalog price, no floor) — and gate those orders behind **admin approval** before they can be processed. **Bundled in:** the salesman **Quick Order collapse revamp** — rows collapse to name + price, and tapping a row reveals its **stepper** (the same `[−] qty [+]`, just hidden until tapped) — and, for LG, the price input — **inside** the "drop". It ships in the same salesman commit because it rewrites the same product rows. Design: [docs/phase3-multi-brand-design.md](../docs/phase3-multi-brand-design.md) ("Pricing mode per brand", "Approval gate"), [docs/specs/order-lifecycle.md](../docs/specs/order-lifecycle.md) (the `pending_approval` / `approved` states), [docs/specs/roles-and-permissions.md](../docs/specs/roles-and-permissions.md) (approve = admin-only, the first genuinely admin-exclusive RPC).

## Commit order (decided): Backend → Salesman Quick Order (collapse revamp + manual price) → Dashboard approval
Create before approve — the approval commit then acts on real, app-created LG orders. The **collapse revamp folds into the salesman commit** because it rewrites the same product rows; do them as one row-rewrite rather than twice.

## Scope guardrails (read first)
- **Fixed brands (Zebronics, Luminous) must be COMPLETELY unaffected** — untamperable catalog-snapshot pricing, land in `submitted`, unpriced products stay hidden (D2). The manual/approval paths activate **only** for brands flagged `pricing_mode='manual'` / `requires_approval=true`.
- **The trust boundary relaxes ONLY for manual brands** — for a manual-brand line the RPC accepts the client-sent price (validate `> 0` + a fat-finger ceiling, **no floor**); fixed brands keep the can't-be-tampered "snapshot from catalog, ignore client price" guarantee.
- **Backward-compatible + signature-stable RPCs** — the deployed `main` app (fixed-brand clients that send no per-line price) must keep working unchanged. Extend the line payload with an **optional** price the RPC reads *only* for manual brands.
- **Admin-only approval** — `approve_order` role check is `v_role = 'admin'` (NOT `in ('accountant','admin')`); the `guard_order_transition` trigger must also reject any non-admin `→ approved`.
- **Reject = cancel-with-reason** (no separate reject status). **Approval beats the timer** — approving locks the salesman out immediately, like `process_order`.
- Money: rupees → integer paise, **≤2 decimals accepted, >2 rejected** (the M5.5 rule). 
- **Shared PROD DB** (owner is developing in prod, no real users yet): the migration is additive (existing brands default `fixed`/no-approval), so it's safe — but keep it backward-compat so the deployed app keeps working.
- Each commit compiles + runs; reviewer verifies by execution (desktop **and** phone).

## Current state (verify live with `list_tables` / `pg_get_functiondef` before migrating)
- `brands`: `id, name, active, code` → add `pricing_mode`, `requires_approval`.
- `orders.status` CHECK = `('submitted','processed','cancelled')` → widen. `orders` has `brand_id`, `editable_until`; add `approved_at`, `approved_by`.
- `submit_order` (signature-stable: derives `brand_id`, single-brand guard, `ORD-<code>` ref, status `submitted`, snapshots price from catalog).
- `process_order` (`submitted → processed`). `update_order_items` = the **4-arg `p_reason`** body (don't regress ㉘ / the M5.5 `tally_name` audit key).
- `guard_order_transition` trigger enforces the legal edges.
- **`products_select_salesman`** RLS = `active AND price_paise IS NOT NULL` — this currently **hides unpriced products**, which would wrongly hide manual-brand (LG) products (they have no catalog price). Must change (commit 1).
- `QuickOrder.tsx` already has the Phase-3a brand dropdown + Brand▸Category grouping + lazy brand-lock — the manual-price UI composes on top.

---

## Commit 1 — Backend: pricing mode, approval states, RPCs, manual-product visibility
New migration `supabase/migrations/<ts>_lg_manual_approval.sql` (MCP-applied, repo-tracked):
1. **`brands.pricing_mode text not null default 'fixed' check (pricing_mode in ('fixed','manual'))`** + **`brands.requires_approval boolean not null default false`** (existing brands stay fixed/no-approval → unaffected; keep the two flags independent per the design).
2. **Widen `orders.status`** CHECK to `('submitted','pending_approval','approved','processed','cancelled')`.
3. **`orders.approved_at timestamptz`**, **`orders.approved_by uuid references profiles(id)`**.
4. **`submit_order` (`create or replace`, keep it working for no-price clients):**
   - Manual-brand lines: take the **client-supplied unit price**, validate `> 0` and `<=` a sane ceiling (**no floor**), snapshot into `order_items.unit_price_paise`, and record who entered it in the `order_events` payload. Fixed-brand lines: snapshot from catalog exactly as today, **ignore any client price** (untamperable).
   - **Initial status** = `brand.requires_approval ? 'pending_approval' : 'submitted'`.
   - Extend the line payload with an **optional** price key; fixed-brand clients that omit it must behave byte-for-byte as before.
5. **`update_order_items`** (`create or replace` from the **current 4-arg `p_reason` body**): allow editing a manual line's price within the window (same trust rule; fixed lines keep catalog snapshot).
6. **New `approve_order(p_order_id uuid)` RPC — admin-only** (`v_role = 'admin'`): `pending_approval → approved`, stamp `approved_at`/`approved_by`, log event `approved`, and lock the salesman out immediately (beats the timer). Reject if the order isn't `pending_approval`.
7. **`process_order`:** accept `submitted` (fixed) **or** `approved`; **reject `pending_approval`** ("must be approved first").
8. **`guard_order_transition`:** add legal edges — draft→`pending_approval`, `pending_approval`→`approved` (admin only), `pending_approval`→`cancelled`, `approved`→`processed`, `approved`→`cancelled`; reject `pending_approval`→`processed`, `submitted`→`approved`, and any non-admin `→approved`.
9. **`products_select_salesman` RLS:** show manual-brand products even when unpriced — `active AND (price_paise IS NOT NULL OR (select b.pricing_mode from brands b where b.id = products.brand_id) = 'manual')`. Fixed brands keep NULL = hidden (D2).
10. Regenerate `src/lib/types/database.types.ts`.

**Test setup (after this commit):** flag/create an **LG** brand — `pricing_mode='manual'`, `requires_approval=true`, `code='LG'`, active — plus a few LG products (no price). (The owner's real LG, on the shared prod DB.)

**Acceptance:** an LG order submitted with per-line prices → lands `pending_approval`, `unit_price_paise` = entered value, event records the enterer; `approve_order` as admin → `approved` (as accountant → **denied**; guard rejects non-admin `→approved`); `process_order` on `approved` → `processed`, on `pending_approval` → **rejected**; **Zebronics/Luminous submit → still `submitted`, catalog-priced, client price ignored, fully unchanged**; unpriced LG products are salesman-visible while unpriced fixed-brand products stay hidden; `npm run build` clean.

## Commit 2 — Salesman Quick Order: collapse-to-reveal revamp + manual-price entry
Rework the product rows in `src/app/new-order/QuickOrder.tsx` (+ its module CSS) to a **collapse-to-reveal ("dropdown") shape** AND add the manual-price input — **one row rewrite covering both**, composing with the Phase-3a Brand▸Category grouping + brand lock. (Salvaged from `test/salesman-ui-collapse` `874f090`/`fecc555` — re-implement fresh; that branch is pre-3a stale.)

**Collapse / reveal ("dropdown" rows):**
- **Collapsed** = `name + price (+ "· N in cart" if in cart) + a chevron`, the whole head a **real ≥48px tap `<button>`**. Fixed brand: price = catalog price. Manual brand: price = the salesman's **entered** price, or a **"Tap to price"** prompt if unset.
- **Tapping reveals**, below the head: the **qty stepper** (the current `[−] qty [+]`, unchanged — just hidden until tapped) **and**, for manual brands, the **price input**. The stepper is **not** replaced — it lives *inside* the drop.
- **Per-row independent** (a `Set<string>` of expanded ids, **not** an accordion — several rows stay open at once). **In-cart rows pre-expanded**: seed the Set **once** from lines with qty>0 so drafts/in-cart lines show their controls without a tap.
- **Chevron:** the **`▾` glyph**, sized comfortably for a phone (~**14–16px** — bigger than the dashboard's), rotate **180° on expand** with a transition. **If a filled `▾` reads chunky at that size, use the thin CSS-border chevron** (`border-right`+`border-bottom`, `rotate(45deg)`→`rotate(225deg)`) — it stays crisp when enlarged. Tune by eye on a real phone; either is fine. *(Ignore the admin `FilterDropdown` chevron — owner says leave it.)*

**Manual-price entry (in the revealed area):**
- For a `manual` brand the revealed area holds the **price input** (`₹`, ≤2 decimals → paise, `> 0`); the salesman types the unit price (no catalog price exists). Fixed brands: catalog price, no input.
- **Review (S5):** show the entered unit prices + line amounts + total; submit sends them (the optional price key from commit 1).
- **Status chips — update the shared `getOrderStatusTag` (`src/lib/order-status.ts`):** add **`pending_approval`** (amber, "Waiting for office approval") + **`approved`** (neutral/ink — distinct from green `Processed`). It's the *shared* chip, so this one change surfaces the new states on the **salesman Home list (S2)**, the **order detail (S7)**, **and** the **dashboard (S8)** — do it here so the salesman sees "pending approval" on their own LG order the moment they submit.
- **Salesman order detail (S7):** a `pending_approval` order stays salesman-editable within the 2h window (approval beats it); show the awaiting-approval / approved messaging.

**Tap targets:** collapsed head ≥48px; the revealed stepper/keypad keep their ≥48px. Cart bar, search, sticky Brand▸Category headers, keypad sheet all unchanged.

**Acceptance:** rows show name+price until tapped; tapping reveals the stepper (+ manual price input for LG), tapping again collapses, **multiple rows open at once**; in-cart rows start expanded and show "· N in cart" when collapsed; a manual (LG) line can be priced (expand→input) with its price shown on the collapsed row; ₹x.5 stores paise, `>2` decimals rejected; a Zebronics/Luminous order is still catalog-priced with no input; chevron rotates + is comfortably sized on phone; **all tap targets ≥48px**; brand grouping + sticky headers + cart bar intact; `npm run build` clean; verified on a phone-width viewport.

## Commit 3 — Dashboard: Pending approval tab + admin Approve
- **S8 ledger:** add a **Pending approval** filter tab (folds into the two-stage scoped counts). The `pending_approval` / `approved` **chips already exist from commit 2** (shared `getOrderStatusTag`) — reuse them, don't redefine.
- **S9 workbench:** an **Approve** action (admin-only button, **hidden for the accountant**) on a `pending_approval` order → `approve_order`; **Mark processed** stays blocked until the order is `approved`; show `approved_by`/`at` in the history register.

**Acceptance:** admin sees LG orders under Pending approval and approves them; **accountant cannot** (no button, and the RPC/guard deny it); approved orders become processable, pending ones can't be processed; chips render (amber pending · ink approved · green processed); build clean.

---

## Guardrails recap
Fixed brands untouched (untamperable catalog pricing, unchanged flow). Manual trust-boundary + manual-product visibility only for `manual` brands. Admin-only `approve_order` + guard-trigger enforcement. Reject = cancel-with-reason. Approval beats the timer. Backward-compat, signature-stable RPCs (deployed `main` keeps working on the shared prod DB). ≤2-decimal money → paise. Reviewer verifies by execution, desktop + phone.
