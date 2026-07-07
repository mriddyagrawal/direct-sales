# BUILDER PROMPT — M5: Accountant / Admin dashboard (Orders · Retailers · Products)

You are the **BUILDER** for `direct-sales`. Backend (7 tables, RPCs, triggers, RLS, seed), app foundation (Next.js + `@supabase/ssr` auth + design system), and the **salesman order flow (M4)** are all done, merged to `main`, and reviewer-verified. Your milestone is the **accountant/admin command center**: see orders live, lock them before Tally, correct them with a trace, print a pick slip for the godown, run the retailer verification queue, and price the catalog.

Work in small atomic commits on branch **`feature/accountant-dashboard`**. A REVIEWER verifies every commit by execution and appends to `comments.md`; read the newest blocks before each commit, fix any 🔴 in the very next commit, never edit review blocks. Commit messages must be **literally accurate**.

---

## 0. Two owner deviations from the spec (2026-07-07) — update the spec in the same commit

The design/specs predate these owner decisions; where they conflict, the owner wins, and you must update the affected spec file **in the same commit** (changelog discipline):

1. **A phone/responsive version is required.** [accountant-dashboard.md](docs/specs/accountant-dashboard.md) §Non-functional says "no mobile layout required" — **overridden.** The dashboard must work on a phone, not just ≥1280px desktop.
2. **Build an in-app Products (pricing) tab.** accountant-dashboard.md §5 defers pricing to Supabase Studio — **overridden.** Pricing is now an in-app screen.

(User management stays in Supabase — there is **no** Users tab; see the runbook at [docs/add-user-runbook.md](docs/add-user-runbook.md). Do not build user CRUD.)

## 1. Re-ground the "FIELD_OPS_V2" mock to *our* reality

The owner's mock sets the **aesthetic** (dense instrument/ledger, left rail, live-sync footer, mono figures, flat status tags, the workbench detail with an event timeline + actions). Adopt that look — it's your approved S8/S9 grammar — but translate every borrowed detail to this business:

- **₹ en-IN, not `$`.** Money is integer paise; render with the existing `formatRupees` in `src/lib/format.ts`.
- **No tax lines.** Prices are **GST-inclusive** (D5). The mock's `SUBTOTAL / TAX / TOTAL` collapses to a single **Total** (label it "Total (incl. GST)" if you like). Never compute or display tax.
- **Our statuses only:** `Submitted` (editable / locked) · `Processed` · `Cancelled` — with the colored-square tags (accent/amber/grey/green/red per the design spec). Not `PROCESSING/CLEARED/FAILED/PENDING_REVIEW`.
- **Real event timeline** from `order_events` (see the catalog in order-lifecycle.md): `submitted`, `items_changed`, `edited_after_lock`, `processed`, `cancelled`, `retailer_quick_added` — humanized ("Submitted 11:42 by Raju", "Edited after lock 14:20 by Accountant — TT27 qty 5→10, reason: shop called").
- **Real scale:** ~20 orders/day, ~42 SKUs, 1–2 salesmen. No 82-page pager, no "Automated / Legacy Retail Partner" filler. "CLIENT" → **retailer**.

## 2. Source of truth

- **[docs/specs/accountant-dashboard.md](docs/specs/accountant-dashboard.md)** — screens (orders list, order detail/workbench, pick slip, retailers), realtime/polling, keyboard, and the **6 acceptance criteria**.
- **[design/phase1-design-spec.md](design/phase1-design-spec.md)** — **S8** (orders list desktop), **S9** (accountant workbench), **S10** (pick slip), **S11** (retailer verification queue); status system, buttons (one filled-accent action per view — here it's **Mark processed**), Print = the only ink-filled control.
- **[docs/specs/order-lifecycle.md](docs/specs/order-lifecycle.md)** (transitions, edit-after-lock, event catalog), **[docs/specs/roles-and-permissions.md](docs/specs/roles-and-permissions.md)** (RLS matrix), **[docs/specs/data-model.md](docs/specs/data-model.md)**.

## 3. What's already there

- Route **`/dashboard`** exists as the S8 shell (built in app-foundation) — **extend it**, don't duplicate. The app already role-routes accountant/admin here.
- Reuse the design system (`src/components/ui/` `Button`/`Field`/`StatusTag`, tokens/fonts), and `src/lib/` (`format.ts`, `order-status.ts` for the derived lock/countdown). All reads are RLS-scoped: accountant/admin **see all** orders/retailers/products; salesman code is untouched.

## 4. Deliverables (ordered; one atomic commit per screen/capability unless noted)

1. **Nav shell — 3 tabs only: Orders · Retailers · Products.** Left rail on desktop; a workable mobile nav on phone. Keep the mock's slot-grammar but render only these three. Sign-out + who's-signed-in in the top chrome. (No Dashboard/Inventory/Routes/Reports/Users.)
2. **Orders list (`/dashboard`)** — dense table, newest first: ref · submitted (IST) · salesman · retailer (+NEW badge) · line count · total · status chip · live countdown. **Filters** (status, salesman, date IST buckets) + **search** by ref/retailer (`/` focuses it, `Enter` opens the row). **Live**: Supabase **Realtime** so a new order appears **≤5s without refresh** with a brief row highlight; **30s polling is an acceptable fallback (D6)** — pick one and make criterion #1 pass. Row → order detail.
3. **Order detail / workbench** — header (ref, status, retailer + phone, salesman, submitted/processed times, countdown if editable); **lines** (snapshot name, qty, unit price, line total) + **Total (incl. GST, no tax row)**; **notes** prominent; **event timeline** from `order_events`, humanized. Actions:
   - **Mark processed** — the one filled-accent action; one click + confirm; calls `process_order`; salesman goes read-only instantly.
   - **Edit** — line editor; calls `update_order_items`; **after the window it requires a reason** and logs `edited_after_lock` (surviving lines keep their snapshot price, added lines snapshot now — the RPC already enforces this; send the full item set).
   - **Cancel** — **reason required** (accountant), confirm dialog; calls `cancel_order`.
   - **Print pick slip** (below).
4. **Print pick slip (S10)** — **print-CSS** view (no PDF library), one order per **A4** page: GANPATI ENTERPRISES header, ref, submitted, retailer+area+phone, salesman; **QTY column first and large** (godown reads quantities, ≥16pt), item names **verbatim** and never truncated, notes box (dropped if empty), Packed-by/Checked-by rules. **Prices OFF by default**; a toggle adds RATE/AMOUNT/Total and flips the badge to **ORDER COPY** (so paper can't be misfiled). GST-inclusive rates, no tax lines.
5. **Retailers (`/dashboard/retailers`) — verification queue (S11)** — list with a `verified` filter; a salesman quick-add (`verified=false`) opens **straight into inline edit** (name/area/phone — canonical spelling becomes the Tally ledger mapping in Phase 2) → **Save & verify** (fixing the spelling *is* the verification act). Deactivate (never delete) dead shops; deactivated rows dim + Reactivate. Writes go through the accountant's RLS `UPDATE`/`ALL` on `retailers`.
6. **Products (`/dashboard/products`) — pricing (owner-added)** — ledger list of **all** SKUs incl. the 8 unpriced (TBD); inline-edit **price** (enter ₹ whole rupees → store integer **paise**; GST-inclusive; reject non-integer/negative), **active**, **tally_name**. Setting a price on a TBD SKU **makes it visible to salesmen immediately (D2)** — no deploy. Writes ride the accountant/admin RLS `UPDATE` on `products`. Flag which rows are still TBD.
7. **Responsive phone version (owner-added)** — one codebase, two layouts: desktop keeps the dense tables; on phone the order/retailer/product lists become **scrollable card lists** (tap → detail), and the order **workbench stacks** (lines table scrolls sideways in its own `overflow-x:auto` box; timeline + notes below; Mark processed/Print/Edit/Cancel as full-width buttons). Don't horizontally-scroll the whole page.

## 5. Acceptance criteria (Phase 1 exit — must pass)

1. An order submitted on a phone appears on an already-open dashboard **within 5s, no refresh**.
2. **Mark processed** → the salesman's app is read-only for that order within one interaction, **and a forged salesman RPC is rejected server-side**.
3. A **post-lock edit requires a reason** and shows in the timeline with before/after.
4. Pick slip **prints legibly on A4** from Chrome; qty column readable at arm's length; prices-off by default.
5. A quick-added retailer shows **NEW** → verify flow cleans the name → badge clears; the shop's order history is preserved.
6. Setting a price on a **TBD** product makes it appear to the salesman (verify: log in as salesman, the newly-priced SKU shows in Quick Order).
7. The whole thing is **usable on a phone** (nav, list, detail, actions) — not just ≥1280px.

Test path for the REVIEWER: the 3 accounts in [docs/m1-test-accounts.md](docs/m1-test-accounts.md) — accountant (`mriddyagrawal@gmail.com`) and admin (`kumarvikramagrawal@gmail.com`) drive this; salesman (`mridul289agrawal@gmail.com`) confirms the cross-effects (read-only on process, newly-priced SKU appears).

## 6. Out of scope (do NOT build here)

- **User management** — no Users tab; accounts are created in Supabase (see [docs/add-user-runbook.md](docs/add-user-runbook.md)).
- **Tally export** (Phase 2), **bulk order selection**, **Reports/Inventory/Routes** tabs, collections/pricing-tiers (Phases 4–5).
- The salesman app (M4, done) — don't touch it beyond shared primitives.

## 7. Do NOT

- Display or compute **tax** (GST-inclusive, D5); use `$` or floats for money (₹, integer paise).
- Invent statuses/events — use ours (`submitted/processed/cancelled` + the `order_events` catalog).
- Let the accountant write orders/products/retailers by any path other than the RPCs (orders) or the RLS-granted `UPDATE` (products/retailers); trust the client clock for the lock (it's `editable_until` + the RPC guard).
- Build user CRUD or touch `auth.users` from the app.
- Fork the design system or add shadows/gradients/rounded cards (hairlines + 2px); horizontally scroll the page body on mobile.
- Edit the reviewer's blocks in `comments.md`, or stack new work on an unfixed 🔴.
