# Builder prompt — Deposits (cash-collection ledger)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-19** · grounded against the live schema + the `/deposits` placeholder + reusable components.

## Goal, one line
A **positive ledger of cash collected**: pick a retailer, enter the amount received (+ how it was paid), it becomes a record. **No credit, no invoices, not linked to orders.** The salesman tracks his own; the office (admin + accountant) sees all and reconciles against real cash.

## Decisions (LOCKED — owner 2026-07-19)
- **Corrections:** the **creating salesman** may **edit or void his own** deposit within a **1-hour window**; after that, only an **admin** can (anytime). **Removal is ALWAYS a VOID with a required reason** — never a hard delete: the row is kept, struck-through, excluded from totals, and logged. **Nothing ever disappears.** Edits work the same way (salesman in-window / admin anytime).
- **Audit log — keep everything:** every create / edit / void is logged with **before → after** in a `deposit_events` table (mirrors `order_events`). Storing it now; a viewer can come later (no detail page yet).
- **Record-only** (no approval status). **Method = Cash / Cheque / Online (UPI)** (required) **+** optional **note**.
- **Who can add:** salesman **and** admin/accountant — exactly like they can all add orders. Same **"New deposit" FAB** on both the salesman page and the office view (style it to match the existing "New order" FAB).
- **No detail page** — a deposit is one line; tapping your own in-window row opens the edit.
- Not linked to orders; retailer-level; amount **paise**, **> 0**. **Naming: "Deposits."**

## Design intent — per role (the owner cares; match the app's look — tokens, chips, OrdersView list/table rhythm)
- **Salesman — `/deposits` (phone-first) · "how much have I brought in?"** Hero = his running totals (**Today ₹X · This week ₹Y**), then his own day-grouped history, then the **New deposit** FAB. Voided rows show struck + muted, not counted.
- **Accountant — dashboard · "does the cash reconcile?"** Hero = reconciliation for a chosen day (default today): **per-method totals** (Cash to count · Cheque to bank · Online to verify) + **per-salesman totals** (each hand-in target). Itemized list below. View-only on rows.
- **Admin — dashboard · "oversight + fix mistakes."** Same all-view, **wider ranges** (week/month), **edit + void on any row** (past the window). One shared office component; admin just gets the correction actions.
- **Responsive, like the orders dashboard:** salesman page is **phone-first** (totals band, stacked list, FAB). The **office view adapts by viewport** — desktop = summary cards across the top + a real **table** (salesman · retailer · amount · method · time · actions) + a filter toolbar; **collapses to stacked cards on mobile** (mirror `OrdersView`'s mobile/desktop split).

## Current state (verified)
- **`/deposits`** = a live "Coming soon" placeholder in the **salesman bottom nav** ([BottomTabBar.tsx](../src/components/BottomTabBar.tsx)) — replace content, keep nav. Staff live in the **dashboard** ([src/app/dashboard/](../src/app/dashboard/)) — the office view goes there (add a nav entry + FAB like orders).
- **No deposits table** yet.
- **Reuse:** `PickRetailer` ([src/app/new-order/PickRetailer.tsx](../src/app/new-order/PickRetailer.tsx)); `parsePricePaise` ([src/lib/price.ts](../src/lib/price.ts)); `formatRupees`; `formatHistoryDayHeader`/`istDateKey` ([src/lib/format.ts](../src/lib/format.ts)); `SalesmanFilter` ([src/components/orders/SalesmanFilter.tsx](../src/components/orders/SalesmanFilter.tsx)); `OrdersView` ([src/components/orders/OrdersView.tsx](../src/components/orders/OrdersView.tsx)) for the responsive mobile-cards/desktop-table pattern; the "New order" FAB for the FAB style; `StatusTag` chip look; `auth_profile_role()`; the `order_no_seq`/`order_events` patterns.
- **Prod caution:** app + DB LIVE. Branch off `main`. **Commit 1 is a DB migration — hold until the owner says go.**

---

## Commit 1 — DB: tables + RPCs + RLS  ⚠️ owner-approval-gated
Migration `YYYYMMDDHHMMSS_deposits.sql`:
```sql
create sequence if not exists public.deposit_no_seq;
create table public.deposits (
  id             uuid primary key default gen_random_uuid(),
  deposit_no     integer not null default nextval('public.deposit_no_seq'),
  deposit_ref    text not null,                                 -- 'DEP-<no>' (RPC-set)
  retailer_id    uuid not null references public.retailers(id),
  salesman_id    uuid not null references public.profiles(id),  -- recorder/collector (= creator)
  amount_paise   integer not null check (amount_paise > 0),
  method         text not null check (method in ('cash','cheque','online')),
  note           text,
  editable_until timestamptz not null,                          -- created_at + 1 hour
  voided_at      timestamptz,                                   -- null = active
  voided_by      uuid references public.profiles(id),
  void_reason    text,
  created_at     timestamptz not null default now()
);
create index on public.deposits (salesman_id);
create index on public.deposits (retailer_id);
create index on public.deposits (created_at desc);

create table public.deposit_events (
  id         bigserial primary key,
  deposit_id uuid not null references public.deposits(id) on delete cascade,
  actor_id   uuid references public.profiles(id),
  action     text not null,                 -- 'created' | 'updated' | 'voided'
  details    jsonb not null default '{}',   -- created: the values; updated: {before,after}; voided: {reason}
  created_at timestamptz not null default now()
);
alter table public.deposits enable row level security;
alter table public.deposit_events enable row level security;
```
**RLS — SELECT only** (writes via the RPCs): `deposits` → salesman `salesman_id = auth.uid()`, staff `auth_profile_role() in ('admin','accountant')`, godown none. `deposit_events` → **staff only** (the log is an office concern).

**RPCs** (`security definer`, `search_path` pinned, role re-checked, `grant execute … to authenticated`):
- **`create_deposit(p_retailer_id, p_amount_paise, p_method, p_note)`** — role ∈ (salesman, accountant, admin); validate amount > 0 / method ∈ set / retailer exists; `deposit_no := nextval`; `deposit_ref := 'DEP-'||no`; `salesman_id := auth.uid()`; `editable_until := now()+interval '1 hour'`; insert; **log `deposit_events` 'created'** (values); return the row.
- **`update_deposit(p_id, p_retailer_id, p_amount_paise, p_method, p_note)`** — gate `(salesman_id = auth.uid() AND now() < editable_until AND voided_at is null) OR role='admin'`, else raise `'this deposit is locked — ask an admin to correct it'`; capture **before**; update only retailer/amount/method/note; **log 'updated' {before, after}**; return the row.
- **`void_deposit(p_id, p_reason)`** — gate `(salesman_id = auth.uid() AND now() < editable_until AND voided_at is null) OR role='admin'`, else raise `'this deposit is locked — ask an admin to void it'`; **reason required for BOTH salesman and admin** (raise if empty); set `voided_at=now(), voided_by=caller, void_reason`; **log 'voided' {reason}**; return the row. Voided rows stay in the table, struck + excluded from totals. **There is no hard-delete RPC — nothing is ever removed from the table.**

**Acceptance (reviewer verifies live, rolled back):** create sets salesman/editable_until/DEP-ref + logs 'created'; amount 0 / bad method raise; update works for owner-in-window + admin, **raises after the window** / for another salesman, and logs before→after; `void_deposit` (reason required for both) works for owner-in-window AND admin-anytime, is refused after the window for the salesman / for another salesman, sets voided_* + logs 'voided', and a voided deposit drops out of active queries + totals; no hard-delete path exists; SELECT RLS scopes salesman→own / staff→all / godown→none, and `deposit_events` is staff-only. Commit: `feat(db): deposits + deposit_events + create/update/void RPCs + RLS`.

---

## Commit 2 — FE: salesman `/deposits` (phone-first; replace placeholder)
Per "Salesman" above. Fetch own **active** deposits (voided excluded from totals; a voided-by-admin row shows struck + muted). Render `DepositsView role="salesman"`: **hero totals band** (Today / This week), **day-grouped history** (retailer · ₹ · method chip · time), in-window own rows get an **Edit**; **New deposit FAB** → `/deposits/new`; friendly empty state. Salesman shell (top strip + bottom bar). **Acceptance:** own-only, totals correct (exclude voided), chips render, in-window editable; tsc/eslint/build clean. Commit: `feat(deposits): salesman ledger (hero totals + day-grouped history)`.

## Commit 3 — FE: New / Edit flow (`deposit-rpcs.ts` + DepositFlow)
`/deposits/new/page.tsx` + `DepositFlow`: **PickRetailer** → **Amount** (`parsePricePaise`, > 0) → **Method** (segmented Cash · Cheque · Online) → **Note** (optional) → **Save** (`create_deposit`) → back + refresh. **Edit** (`?edit=<id>`, in-window or admin): prefill; Save → `update_deposit`; **Void** (salesman in-window OR admin) → `void_deposit` with a **required reason** — a small reason sheet like cancel-order (no delete anywhere). Add `src/lib/deposit-rpcs.ts` (`createDeposit`/`updateDeposit`/`voidDeposit`, `callRpc` wrapper). Reachable from **both** the salesman FAB and the office-view FAB. **Acceptance:** ~3 taps records a deposit; edit + void (with reason) in-hour work; after the hour the salesman is refused and only admin edits/voids; a voided row goes struck + out of totals; paise end-to-end; tsc/build clean. Commit: `feat(deposits): new + edit flow (retailer · amount · method · note; void-with-reason, 1-hour window)`.

## Commit 4 — FE: office view (admin + accountant) on the dashboard, responsive
Per "Accountant/Admin" + "Responsive" above. A dashboard **Deposits** page (nav entry + a **New deposit FAB** matching the New-order FAB) rendering `DepositsView role="staff"` over **all active** deposits:
- **Reconciliation hero** for a chosen day (default today; admin also week/month): **per-method totals** (Cash / Cheque / Online + grand total) and **per-salesman totals**.
- **Desktop = summary cards + a table** (salesman · retailer · amount · method · time · actions) with `SalesmanFilter` + day picker; **mobile = stacked cards** (mirror `OrdersView`).
- **Voided rows** shown struck + muted, excluded from totals. **Admin only:** per-row **Edit / Void**; the accountant sees the same view without those actions.
- Empty state per filter.

**Acceptance:** admin + accountant see all, per-method + per-salesman totals reconcile with the visible active rows; salesman filter + day picker work; desktop table ↔ mobile cards; admin can edit/void any row (voided excluded + struck), accountant cannot; both can add via the FAB; tsc/eslint/build clean. Commit: `feat(dashboard): office deposits view (reconciliation totals, responsive table/cards, admin void)`.

## Guardrails
- Branch off `main`; **DB migration only after owner OK**; Commits 2–4 DB-free.
- Read newest `comments.md`; fix any ❌.
- Money in **paise** (`parsePricePaise` in / `formatRupees` out; > 0; never a float).
- Window + role gates enforced **in the RPCs**; `editable_until`/`created_at`/`deposit_no`/`salesman_id` immutable after insert; **every removal is a void-with-reason (kept + logged), never a hard delete** — salesman on his own in-window, admin anytime; every create/edit/void writes a `deposit_events` row.
- Match the app's design language (tokens, chips, list/table rhythm, responsive), light + dark legible.
- Commit messages literally accurate — the REVIEWER verifies by execution.
