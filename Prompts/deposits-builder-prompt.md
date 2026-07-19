# Builder prompt — Deposits (salesman cash-collection ledger)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-19** · grounded against the live schema + the existing `/deposits` placeholder + reusable components.

## Goal, one line
A simple **positive ledger of cash collected**: a salesman picks a retailer, enters the amount received (+ how it was paid), and it becomes a record. **No credit, no invoices, not linked to orders.** The salesman tracks his own collections; the office (admin + accountant) sees everything and reconciles against real cash.

## Decisions (LOCKED — owner 2026-07-19)
- **Corrections = a 1-hour window:** the creating salesman may **edit or delete his own** deposit within **1 hour**; after that it's **admin-only**. A delete removes the row (owner's chosen model).
- **Record-only** — no approval status.
- **Method = structured, all three:** **Cash / Cheque / Online (UPI)** (required) **+** an optional **note** (cheque no. / UPI ref / remarks).
- **Not linked to orders**; retailer-level; amount in **paise**, strictly **> 0**. **Naming: "Deposits."**

## Design intent — think per role (the owner cares about this)
This isn't one screen shown three ways; each role has a different job. Match the app's existing look (tokens, `StatusTag`-style chips, the OrdersView list/day-group rhythm) — clean hierarchy, real totals as the hero, no clutter.

- **Salesman — "how much have I brought in?"** His `/deposits` tab is personal + motivating. **Hero = his running totals** (Today ₹X · This week ₹Y), then his own day-grouped history, then a prominent **New deposit** FAB. Fast to record, satisfying to watch grow. Friendly empty state.
- **Accountant — "does the cash reconcile?"** Their lens is **end-of-day reconciliation**. **Hero = breakdowns for a chosen day (default today): per-salesman totals** (match what each hand-in should be) **and per-method totals** (cash to count · cheques to bank · online to verify). The itemized list is supporting detail. View-only on rows (correction is the admin's job).
- **Admin — "oversight + fixing mistakes."** Same all-collections view as the accountant, **plus** row-level **edit/void** (past the 1-hour window too) and the broader time ranges (week/month). Oversight first, correction on tap.

The office view (admin + accountant) is one shared component — same summary + filterable list — differing only in that **admin gets the correct/delete actions** and wider ranges.

## Current state (verified — build against this)
- **`/deposits`** is a live "Coming soon" placeholder in the **salesman bottom nav** ([BottomTabBar.tsx](../src/components/BottomTabBar.tsx) already links it) — replace its content, keep the nav. The **dashboard** ([src/app/dashboard/](../src/app/dashboard/)) is where staff live (Orders / Products / Retailers / Users) — the office deposits view goes there.
- **No deposits table** yet.
- **Reuse:** `PickRetailer` ([src/app/new-order/PickRetailer.tsx](../src/app/new-order/PickRetailer.tsx), `{retailers, recentRetailerIds, salesmanId, onSelect, onBack}`, `SelectedRetailer`); `parsePricePaise` ([src/lib/price.ts](../src/lib/price.ts)); `formatRupees`; `formatHistoryDayHeader`/`istDateKey` ([src/lib/format.ts](../src/lib/format.ts)); `SalesmanFilter` ([src/components/orders/SalesmanFilter.tsx](../src/components/orders/SalesmanFilter.tsx)); `StatusTag`/chip styling for method chips; `auth_profile_role()`; the `order_no_seq`/`order_ref` pattern for `deposit_no`/`deposit_ref`.
- **Prod caution:** app + DB LIVE. Branch off `main`. **Commit 1 is a DB migration — hold until the owner says go.**

---

## Commit 1 — DB: table + RPCs + RLS  ⚠️ owner-approval-gated
Migration `YYYYMMDDHHMMSS_deposits.sql`:
```sql
create sequence if not exists public.deposit_no_seq;
create table public.deposits (
  id             uuid primary key default gen_random_uuid(),
  deposit_no     integer not null default nextval('public.deposit_no_seq'),
  deposit_ref    text not null,                    -- 'DEP-<no>' (set in the RPC)
  retailer_id    uuid not null references public.retailers(id),
  salesman_id    uuid not null references public.profiles(id),  -- the recorder/collector
  amount_paise   integer not null check (amount_paise > 0),
  method         text not null check (method in ('cash','cheque','online')),
  note           text,
  editable_until timestamptz not null,             -- created_at + 1 hour
  created_at     timestamptz not null default now()
);
create index on public.deposits (salesman_id);
create index on public.deposits (retailer_id);
create index on public.deposits (created_at desc);
alter table public.deposits enable row level security;
```
**RLS — SELECT only** (writes via the RPCs): salesman → `salesman_id = auth.uid()`; staff → `auth_profile_role() in ('admin','accountant')`; godown → none.

**RPCs** (`security definer`, `search_path` pinned, role re-checked, `grant execute … to authenticated`):
- **`create_deposit(p_retailer_id uuid, p_amount_paise int, p_method text, p_note text)`** — role ∈ (salesman, accountant, admin); validate amount > 0, method ∈ set, retailer exists; `deposit_no := nextval`; `deposit_ref := 'DEP-'||deposit_no`; `salesman_id := auth.uid()`; `editable_until := now() + interval '1 hour'`; insert; return the row.
- **`update_deposit(p_id, p_retailer_id, p_amount_paise, p_method, p_note)`** — allow when `(salesman_id = auth.uid() AND now() < editable_until) OR role='admin'`, else raise `'this deposit is locked — ask an admin to correct it'`; validate; update **only** retailer/amount/method/note (never `deposit_no`/`created_at`/`editable_until`/`salesman_id`); return the row.
- **`delete_deposit(p_id)`** — same gate; delete.

**Acceptance (reviewer verifies live, rolled back):** salesman create sets `salesman_id`=caller, `editable_until`=+1h, `DEP-` ref; amount 0 / bad method raise; update+delete succeed for the owner within the window, **raise after `editable_until`**, succeed for admin anytime, refused for a different salesman; SELECT RLS scopes salesman→own / staff→all / godown→none. Commit: `feat(db): deposits table + create/update/delete RPCs + RLS`.

---

## Commit 2 — FE: salesman `/deposits` (replace the placeholder)
Design per "Salesman" above. `/deposits/page.tsx` fetches the salesman's own deposits (RLS) + retailer names; renders **`DepositsView role="salesman"`**:
- **Hero totals band:** Today ₹X · This week ₹Y (sum of `amount_paise`, `formatRupees`), This-week the larger figure.
- **Day-grouped history** (`formatHistoryDayHeader`, newest first): each row **retailer · ₹amount · method chip · time**. A row still inside its 1-hour window shows a small **Edit** affordance → the flow (Commit 3); locked rows don't.
- **Method chips:** Cash / Cheque / Online — small, token-coloured, consistent (e.g. reuse the chip look; keep the three visually distinct but calm).
- **FAB "New deposit"** → `/deposits/new`. Friendly **empty state** ("No collections yet — tap ＋ to record one"). Same salesman shell (top strip + bottom bar).

**Acceptance:** salesman sees only his own, day-grouped, hero totals correct, method chips render, in-window rows editable; tsc/eslint/build clean. Commit: `feat(deposits): salesman collection ledger (hero totals + day-grouped history)`.

## Commit 3 — FE: New / Edit deposit flow
`/deposits/new/page.tsx` + a `DepositFlow` client component — a tiny flow: **PickRetailer** (reuse) → **Amount** (rupee input → `parsePricePaise`, reject ≤ 0) → **Method** (segmented **Cash · Cheque · Online**, required) → **Note** (optional) → **Save** → `create_deposit` → back to `/deposits` (`router.refresh()`). **Edit mode** (`?edit=<id>`, entered only within the window or by admin): prefill; **Save** → `update_deposit`; **Delete** → `delete_deposit`. Add **`src/lib/deposit-rpcs.ts`** (`createDeposit`/`updateDeposit`/`deleteDeposit`, mirroring `order-rpcs.ts`'s `callRpc`).

**Acceptance:** ~3 taps + an amount records a deposit that lands in the list with the right retailer/amount/method; edit within the hour works, delete removes it; after the hour the edit entry is gone and the RPC refuses; admin can still correct; paise end-to-end; tsc/eslint/build clean. Commit: `feat(deposits): new + edit flow (retailer · amount · method · note, 1-hour window)`.

## Commit 4 — FE: the office view (admin + accountant) on the dashboard
Design per "Accountant" + "Admin" above. A dashboard **Deposits** page/section (add the nav entry alongside Orders/Products/Retailers/Users) rendering **`DepositsView role="staff"`** over **all** deposits:
- **Reconciliation summary = the hero:** for a **selected day** (default today; admin also gets week/month) —
  - **Per-method totals:** Cash ₹ · Cheque ₹ · Online ₹ (+ grand total). This is the cash-count / cheque-deposit worksheet.
  - **Per-salesman totals:** each salesman → ₹ collected that day (what their hand-in should reconcile to).
- **Filterable list** below: `SalesmanFilter` + the day picker; rows = **salesman · retailer · ₹amount · method chip · time**.
- **Admin only:** each row is tappable → **Edit / Void** (`update_deposit`/`delete_deposit`, allowed past the window); the accountant sees the same view **without** those actions.
- Empty state per filter ("No collections for this day").

**Acceptance:** admin + accountant see all deposits with the per-method + per-salesman reconciliation totals for the chosen day; the salesman filter + day picker work; admin can correct/void any row and the accountant cannot; totals reconcile with the listed rows; tsc/eslint/build clean. Commit: `feat(dashboard): office deposits view (per-method + per-salesman reconciliation, admin corrections)`.

## Guardrails
- Branch off `main`; **DB migration only after owner OK**; Commits 2–4 DB-free.
- Read newest `comments.md`; fix any ❌.
- Amount is **money in paise** — `parsePricePaise` in, `formatRupees` out; > 0; never a float.
- The 1-hour window + role gate are enforced **in the RPCs** (server), not just the UI; `editable_until`/`created_at`/`deposit_no`/`salesman_id` immutable after insert.
- Match the existing app design language (tokens, chips, list rhythm) — clean hierarchy, totals as the hero, calm method chips, real empty states. Light + dark legible.
- Commit messages literally accurate — the REVIEWER verifies by execution.
