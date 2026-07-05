# Architecture — Ganpati Enterprises Direct Sales

## 1. Design principles

1. **Capture tool, not ERP.** Tally remains the statutory system of record (invoices, GST, stock, ledgers). The app records *what was ordered* and hands it downstream. The moment this app tries to own accounting or inventory, the project dies.
2. **Faster than the notebook, or it fails.** Every screen is held to one test: is this quicker than paper? The notebook is the real competitor, not other software.
3. **Rules live in the database.** Row Level Security and triggers enforce who can touch what and when. The UI merely *reflects* the rules; it never *is* the rules. A salesman with a crafted HTTP request must hit the same walls as one using the app.
4. **History is immutable.** Order lines snapshot name + price at write time; every state change and post-lock edit lands in an audit table. Historical orders never silently change.
5. **Boring, small, one repo.** No microservices, no queues, no custom auth. <20 orders/day is not a distributed-systems problem.

## 2. System overview

```
  Salesman (phone,          Accountant (desktop,
  mobile browser)           Chrome)
        │                        │
        ▼                        ▼
  ┌─────────────────────────────────────┐
  │   Next.js app (Vercel)              │
  │   /            → salesman flow     │
  │   /dashboard   → accountant flow   │
  └───────────────┬─────────────────────┘
                  │ supabase-js (anon key + RLS)
                  ▼
  ┌─────────────────────────────────────┐
  │   Supabase                          │
  │   Postgres (schema + RLS + trigs)   │
  │   Auth (email/password, D3)        │
  │   Realtime (orders → dashboard)    │
  └───────────────┬─────────────────────┘
                  │  Phase 2: Tally XML export (downloaded file,
                  ▼  manually imported — later, a local sync agent)
            Tally on the office PC  ←— statutory system of record
```

There is no self-hosted server, no cron infrastructure, no third service. The office PC never talks to the cloud directly in Phase 1.

## 3. Stack and why

| Choice | Why |
|---|---|
| **Next.js (App Router)** on **Vercel** | One deployable for both interfaces; server actions for privileged mutations; zero-ops hosting. |
| **Supabase** (Postgres + Auth + RLS + Realtime) | Managed Postgres with row-level security as the permission system, built-in email/password auth (D3), and realtime subscriptions that make the dashboard live for free. Patterns already proven in the owner's `quoteit` project (verified: snapshot line items, sequence-based refs, own-rows RLS, `touch_updated_at` trigger). |
| **Tailwind CSS** (builder's discretion) | Fastest path to a dense, consistent mobile UI. Not load-bearing; vanilla CSS acceptable if the builder prefers. |
| **Integer paise** for all money | `₹523` is stored as `52300`. No floats anywhere; totals recomputed server-side; display via `Intl.NumberFormat('en-IN')`. |

**What we deliberately don't use:** no ORM (supabase-js + SQL migrations suffice), no state-management library beyond React state (the cart is one screen), no service worker/PWA machinery in Phase 1 (see resilience, below).

## 4. Application structure

- `/login` — email + password (no self-signup; accounts are admin-created, D3).
- `/` — salesman home: my orders + "New Order". Salesman flow per [specs/salesman-app.md](specs/salesman-app.md).
- `/orders/[id]` — order detail (status, countdown, edit/cancel while permitted).
- `/dashboard` — accountant: live order list, detail, process/edit/cancel/print per [specs/accountant-dashboard.md](specs/accountant-dashboard.md).
- **Mutations** that must bypass client tampering (submit, process, post-lock edit) go through **Postgres functions (RPC)** or server actions, so guards run inside the database transaction. Reads use supabase-js with RLS.
- **Migrations** live in `supabase/migrations/*.sql`, applied via the Supabase CLI. The schema in [specs/data-model.md](specs/data-model.md) is the source of truth.

## 5. Resilience (deliberately *not* offline-first)

Shops have dead zones; the app must never lose an order, but full offline sync is out of scope (see problem statement §6):

- The in-progress cart **autosaves to `localStorage`** on every change and survives page reloads, crashes, and dead zones.
- The catalog (~42 rows) is fetched once and cached in memory/localStorage with a staleness timestamp.
- Submit **retries with backoff** and is idempotent (client-generated order UUID), so a double-tap or a retry after timeout cannot create duplicates.
- If connectivity is truly gone at submit time, the draft stays local with a visible "pending — retry" state. That is the whole story; no service workers, no sync engines.

## 6. Environments, deploy, and cost reality

- **Two Supabase projects**: `dev` and `prod`. Migrations applied to dev first; prod promoted after the TESTER's review passes.
- **Vercel**: preview deploys per branch; production on `main`.
- **Cost gotchas (known, accepted, revisit at go-live):**
  - Supabase Free **pauses projects after ~1 week of inactivity** — fatal for a business tool. Before the pilot ends, upgrade prod to **Pro (~$25/mo)**, which also brings daily backups.
  - Vercel **Hobby is licensed for non-commercial use**; this is a commercial tool. Budget **Pro ($20/mo)** at go-live or consciously accept the ToS risk during the pilot.
  - Backups: Supabase Pro daily backups + a periodic `pg_dump` kept locally once real orders exist.
- **Timezone**: all timestamps stored UTC (`timestamptz`); the business operates in IST — all display and any date-bucketing ("today's orders") is done in `Asia/Kolkata`.

## 7. Security posture

- RLS on every table; the anon key is safe to ship in the client *because* RLS is the permission system. Full matrix in [specs/roles-and-permissions.md](specs/roles-and-permissions.md).
- The `service_role` key exists only in server-side env vars (seed script, server actions). Never in client bundles.
- State-machine guards are BEFORE-triggers in Postgres — the client clock and client state are never trusted ([specs/order-lifecycle.md](specs/order-lifecycle.md)).
- PII is minimal: staff names/emails, retailer names/phones. No customer consumers, no payments data.

## 8. Headroom built in for later phases (and no more than that)

- `brands` is a table from day one → Phase 3 multi-brand is "seed another CSV + a filter", no migration.
- `products.tally_name` and `retailers.tally_ledger_name` exist from day one, empty until Phase 2 mapping.
- `orders.status` is a text enum with room for `pending_approval` (Phase 5) without restructuring.
- `order_events` is a general-purpose audit log — Phase 5 price-override trails reuse it as-is.

What we did **not** pre-build: no discount fields, no outstanding-balance tables, no sync-agent stubs. Each phase adds its own migration when it actually arrives ([PLAN.md](../PLAN.md)).
