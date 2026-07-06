# BUILDER PROMPT — M4: The salesman order flow (S3 → S7 + write RPCs)

You are the **BUILDER** for `direct-sales`. The **backend** (7 tables, 4 order RPCs, triggers, RLS, seed) and the **app foundation** (Next.js App Router/TS, `@supabase/ssr` auth, middleware route-protection + role routing, the design system, S1 login, and the S2 Home / S8 Orders shells) are **done and reviewer-verified** — production build is green. Your milestone is the salesman's actual job: **pick a shop, punch quantities, submit, and fix mistakes within the window** — screens **S3–S7**, wired to the write RPCs.

**Success metric (this is the whole point):** a 5–8 line order in **under 90 seconds**, one-handed, on a mid-range Android over spotty 4G. The notebook is the competitor.

Work in small atomic commits on branch **`feature/salesman-app`**. A separate REVIEWER verifies every commit by execution and appends blocks to `comments.md`; read the newest before each commit, fix any 🔴 blocking issue in the very next commit, never edit the reviewer's blocks. Commit messages must be **literally accurate**.

---

## 0. Build on what exists — do not reinvent

- **App:** Next.js 16 (App Router, TypeScript, Turbopack), CSS Modules, `src/` layout. Routes already live: `/login`, `/` (salesman Home / S2), `/dashboard` (accountant S8), `/new-order` (placeholder — **this milestone fills the order flow behind it**).
- **Reuse the design system** in `src/components/ui/` (`Button`, `Field`, `StatusTag`) and `src/components/` (`BottomTabBar`, `OrderCard`, `SignOutButton`), the tokens/fonts in `src/app/globals.css` + `layout.tsx`, and the helpers in `src/lib/` (`format.ts` for ₹ en-IN / IST / refs, `order-status.ts` for the derived lock/countdown). Extend these; don't fork parallel styles. New primitives (e.g. a stepper, a bottom sheet) join `src/components/ui/`.
- **Supabase clients** are in `src/lib/supabase/` (`client.ts` browser, `server.ts` server, `middleware.ts`, `service.ts` secret-key). Generated DB types are in `src/lib/types/database.types.ts` — use them; regenerate via MCP `generate_typescript_types` if you change the schema.
- **The RPCs are already built and verified.** Read their exact signatures + the `p_items` **jsonb shape** in `supabase/migrations/20260706T150400_rpcs.sql` before wiring — do not guess the payload keys.

## 1. Hard constraints (the invariants this flow lives or dies on)

- **The client never sends prices.** `submit_order`/`update_order_items` snapshot `product_name` + `unit_price_paise` from the catalog **server-side**. Send only `product_id` + `qty` (+ notes). A tampered price is ignored by design — don't even collect it.
- **Idempotency via a client-generated order UUID.** Generate the order `id` (uuid) when the cart starts; pass it to `submit_order`. A double-tap or retry-after-timeout carrying the same `id` returns the existing order **untouched** — never a second row. This is the backbone of the offline story; do not defeat it by regenerating the id on retry.
- **Drafts never touch the database.** The in-progress cart lives in `localStorage` only (key = retailer + the client order UUID), autosaved **on every tap**. Postgres sees the order for the first time via `submit_order`, already `submitted`. No draft rows, no server sync.
- **"Locked" is derived, enforced server-side.** Compute the countdown from `editable_until` (in `order-status.ts`); at expiry the UI flips **read-only and the Edit/Cancel buttons are *gone*, not disabled** (per S7). The RPC guards are the real wall — the UI only mirrors them.
- **Salesmen only ever see `active AND priced` products** (RLS guarantees it; ~34 rows). Never render an unpriced/inactive product in list or search.
- **Budgets:** interactive < 2s on 4G; search filters < 50ms (in-memory over ≤100 rows, no network); touch targets **≥ 48px** — the stepper `+` is the most-tapped control, extend its hit area to ≥48px with invisible padding even where the visual cell is 44×50/40×42px (design spec §layout).

## 2. Source of truth — conform exactly

- **[docs/specs/salesman-app.md](docs/specs/salesman-app.md)** — the flow, every screen's behavior, the resilience mandate, and the **6 acceptance criteria** (§below).
- **[design/phase1-design-spec.md](design/phase1-design-spec.md)** — screens **S3 (Pick Retailer)**, **S4 (Quick Order, hero)**, **S5 (Review)**, **S6 (Confirmation)**, **S7 (Order detail, salesman)**; the status system, buttons (one filled-accent per view), the keypad sheet (qty cap **999**, stricter than the DB's 1..9999 — keep it), the sticky split cart bar, in-cart accent treatment.
- **[docs/specs/order-lifecycle.md](docs/specs/order-lifecycle.md)** — states, the edit window, snapshot-on-edit semantics, the event catalog. **[docs/specs/data-model.md](docs/specs/data-model.md)** — table/column truth.
- **[docs/decisions.md](docs/decisions.md)** — esp. D8 (self-cancel hidden from Home; already applied in S2 — keep it consistent when a salesman cancels), D9 (username login).

## 3. Deliverables (ordered; one atomic commit per screen/capability unless noted)

1. **Order-draft + offline infrastructure** (`src/lib/`): a client cart store (retailer + line items keyed by `product_id`, distinct-line count, total), a stable client order UUID, `localStorage` autosave/restore, and a submit queue with retry+backoff + a visible pending state. This underpins S4/S5; build it first so the screens are thin.
2. **S3 · Pick Retailer.** Search-as-you-type over `name` + `area` (RLS-scoped read), **RECENT** (this salesman's recent retailers) then **ALL SHOPS**, NEW tag on `verified=false`. **Quick-add** (name required; area/phone optional) → inserts a `verified=false, created_by=auth.uid()` retailer via the RLS insert policy and proceeds straight into the order. **Resume-draft** bottom sheet (flat, 2px ink top-edge) when a `localStorage` draft exists for a retailer ("Continue order for … · 3 items · ₹4,478 · saved 11:31" → Continue / Start fresh).
3. **S4 · Quick Order (the hero).** Category-grouped dense list (CSV order within groups), sticky client-side search (name+SKU, case/space-insensitive, `1 of 34 products` meta), row = 2-line-clamp name + mono price + `[−] qty [+]` stepper (**+ becomes filled accent once in cart**; in-cart row = pale accent tint + 2px accent left bar + bold qty), tap-qty → numeric **keypad sheet** (product name + current qty, Cancel / Set quantity, scrim-tap discards, cap 999). **Sticky split cart bar**: black data half (`3 items` / mono `₹4,478`) + accent action half (`Review ›`) — survives filtering, never a floating pill. Autosave every tap.
4. **S5 · Review.** Editable line list (steppers + remove, `@ ₹rate` mono per line), retailer header + Change, **NOTES FOR THE OFFICE** (≤500 chars, live counter), computed total, full-width accent **Submit**. Submit calls `submit_order(id, retailer_id, notes, items[])`. On offline/failure: CTA swaps to **amber Retry** over a "Saved on phone — not submitted yet" strip; copy states retrying is idempotent (never a duplicate).
5. **S6 · Confirmation.** Renders **only on confirmed server success**: green check, `ORDER SUBMITTED`, huge mono `order_ref`, shop · total, `■ Editable until HH:MM`, "Back to Home" + "View order". Clear the `localStorage` draft on success.
6. **S7 · Order detail (`/orders/[id]`).** Snapshot lines (`10 × ₹60` mono — catalog changes never rewrite history), notes, retailer card, status tag + live countdown, and **HISTORY reconstructed from `order_events` in plain words** ("12:05 Edited — MU240 qty 8→10", "11:42 Submitted by you"). While editable: **Edit** (reopens S4 pre-filled with the order's lines — existing lines show their **snapshot** price, newly added show catalog price; submit calls `update_order_items`) and **Cancel** (confirm dialog; **no reason required from the salesman**; calls `cancel_order` → the order self-cancels and drops out of Home per D8). After lock/processed/cancelled: read-only with the right message, **buttons gone**.

## 4. Write-RPC wiring (names + behavior — read the migration for exact params)

- `submit_order(p_id, p_retailer_id, p_notes, p_items jsonb)` — new order; idempotent on `p_id`. Items = `product_id` + `qty` only.
- `update_order_items(p_order_id, p_notes, p_items jsonb)` — edit within window; server **diffs by product_id** (survivors keep their snapshot price, new lines snapshot at edit time) and writes an `items_changed` event. Send the full desired item set.
- `cancel_order(p_order_id, p_reason)` — salesman passes **no reason** (reason is required only from the accountant); writes a `cancelled` event.
- After any RPC, surface the server's error text plainly (window expired, product now unpriced, etc.) — the guards are authoritative; don't pre-empt them in the client beyond good UX.

## 5. Acceptance criteria (Phase 1 exit — all must pass, verifiable)

1. **Stopwatch:** a known 6-line order, shop-floor conditions, **< 90s** from "New Order" to confirmation.
2. **Airplane-mode:** mid-cart airplane-mode → reopen app → **draft intact**; submit offline → visible pending state → retry on signal → **exactly one** order in the DB.
3. **Double-tap submit → exactly one order row** (idempotency).
4. **Countdown → 0:** UI flips read-only **and** a forged/late `update_order_items` call is **rejected server-side** (verify the RPC rejects it, not just the UI).
5. Salesman **never** sees an unpriced/inactive product, in list or search.
6. **Order detail reconstructs any edit from `order_events`**, in words the owner could read to a retailer over the phone.

Give the REVIEWER the test path: the 3 accounts in [docs/m1-test-accounts.md](docs/m1-test-accounts.md) (passwords from Mridul); the salesman account (`mridul289agrawal@gmail.com`) drives this whole flow against the live project.

## 6. Out of scope (later milestones — do NOT build here)

- The **accountant workbench** actions: `process_order`, edit-after-lock with reason, cancel-with-reason (S9), the **pick slip** (S10), and the **retailer verification queue** (S11) — that's **M5**. The S8 Orders shell already exists; don't extend it into the workbench.
- Realtime/live-flash, filters, and keyboard nav on the dashboard (M5).
- The desktop styling of these salesman screens — this flow is **mobile-first**; it only needs to be usable, not polished, on desktop.

## 7. Do NOT

- Send or trust client-side prices/totals for persistence (display-only; server snapshots).
- Regenerate the order UUID on retry, write draft rows to the DB, or add server-side draft sync.
- Disable (rather than remove) the Edit/Cancel buttons past the window; trust the client clock for the lock (compute against `editable_until`, and the RPC is the wall).
- Render unpriced/inactive products; call `process_order`/build M5 screens; use `getSession()` for gating in server code (use `getUser()`).
- Fork the design system or hardcode tokens; introduce shadows/gradients/rounded cards (grammar is hairlines + 2px).
- Edit the reviewer's blocks in `comments.md`, or land new functionality on top of an unfixed 🔴.
