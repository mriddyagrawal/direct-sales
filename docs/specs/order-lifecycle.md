# Spec — Order Lifecycle

The state machine, the edit window, numbering, and the audit-event catalog. Enforcement is server-side (RPCs + triggers + RLS) — the UI only mirrors these rules.

> **Overhauled 2026-07-10 (owner decision):** approval is **universal** (every order, every brand, admin-only), the `submitted` status is **gone**, `processed` is renamed **`billed`**, and `brands.requires_approval` is renamed **`brands.requires_scan`** (its only remaining job: "needs the godown scan step"). Price (`pricing_mode`) and scan (`requires_scan`) are independent brand axes.

> **Fulfilment reshaped — Stage 1, 2026-07-11 (owner decision):** the godown fulfils **every** brand. `approve_order` now routes **all** brands to `approved` (Zeb/Lum no longer skip to `ready_to_bill`); the old `pending_approval → ready_to_bill` edge is removed. The pick is **brand-aware** (LG scans serials, fixed brands enter a picked qty) and may be **partial** — `submit_pick` ships the picked qty (→ `ready_to_bill`, total = Σ picked×price) and, when short, splits off a **new `backorder` child** (same salesman, `parent_order_id` link, fresh gapless `order_no`) holding the remainder. A **new `backorder` status** sits before `pending_approval`; **`punch_order`** promotes it (`backorder → pending_approval`, salesman-owner or admin). Ordered line snapshots (`qty`/`unit_price_paise`/`line_total_paise`) stay immutable — `order_items.picked_qty` is additive; `orders.total_paise` is the **shipped** total `Σ(coalesce(picked_qty, qty) × unit_price)`. The `approved` chip stays labelled **"Pending scan"** (not renamed). New events: `backordered` (links parent→child), `picked` now carries an ordered-vs-picked summary. *(Stage 2 — dispatch/`dispatched` — SHIPPED 2026-07-12; see the next block.)*
>
> ```
> backorder ──punch_order──▶ pending_approval ──approve (admin)──▶ approved  ("Pending scan", ALL brands)
>       ──submit_pick (LG: scan · Zeb/Lum: qty; partial ok)──▶ ready_to_bill ──process_order──▶ billed
>    partial pick → original ships picked qty (→ ready_to_bill) + a NEW `backorder` child holds the remainder
> ```

> **Fulfilment Stage 2 — dispatch, 2026-07-12 (owner decision, SHIPPED).** A terminal stage after billing: a **`billed`** order is marked **`dispatched`** when it physically ships, via **`dispatch_order(uuid)`** — done by **godown / accountant / admin** (never the salesman), no input. New status **`dispatched`** (added to `orders_status_check`); columns `dispatched_at`/`dispatched_by`; the bill-no invariant now covers it (`status NOT IN ('billed','dispatched')`). Guard edges: `billed → dispatched` (role-gated in the trigger) and `dispatched → cancelled` (**admin only** — the returns path; `cancel_order` is unchanged, so the accountant stays `pending_approval`-only). New event `dispatched`. Godown SELECT RLS widened to also see `billed`/`dispatched`/`cancelled` (orders/order_items/order_item_scans) + a new **`order_events_select_godown`**. The godown app gains **Dispatch** + **History** tabs, built by **reusing the shared `OrdersView` + `OrderDetailView` with a new `godown` role** (not bespoke screens). Migration `20260711195529`.
>
> ```
> … → billed ──dispatch_order (godown / accountant / admin)──▶ dispatched   (terminal)
>    dispatched ──cancel_order (reason; ADMIN only)──▶ cancelled
> ```

> **Edit window removed + cancel/edit permission matrices — 2026-07-11 (owner decision).** The **2h edit window is gone**: editability is purely status-driven — a salesman edits/cancels only his own **`pending_approval`** order (no timer), read-only after. **`editable_until` is retained but no longer read.** New permission matrices (authoritative in **[cancel-edit-permissions-proposal.md](cancel-edit-permissions-proposal.md)**, migration `20260711153000`):
> - **CANCEL** — salesman: own `pending_approval`; **accountant: `pending_approval` only**; **admin: any live state**. (`backorder → cancelled` is now a legal transition.)
> - **EDIT** — salesman & accountant: `pending_approval` only; **admin: any live state** (`backorder`/`approved`/`ready_to_bill`/`billed`), reason-logged (`edited_after_lock`).
>
> This **supersedes** the "Edit window", the cancel-transition rows, and the per-state edit/cancel tables further down this file — they describe the pre-2026-07-11 model.

## States

```
 (client-side draft)                    ┌──────────────────┐
  localStorage only ── submit_order ──▶ │ pending_approval │   (EVERY brand)
  never in Postgres                     └────────┬─────────┘
                                                 │ approve_order  (ADMIN only)
                        requires_scan = true     │     requires_scan = false
                        (LG)              ┌──────┴──────┐       (Zebronics, Luminous)
                                          ▼             ▼
                                   ┌──────────┐   ┌───────────────┐
                     godown scans  │ approved │   │ ready_to_bill │
                     (submit_pick) └────┬─────┘   └──────┬────────┘
                                        │  └─────────────┤  (approved → billed kept:
                                        ▼                ▼   bill LG without the scan)
                                   ready_to_bill ──▶ ┌────────┐
                                    process_order    │ billed │
                                                     └────────┘
cancel_order (reason from staff) is legal from pending_approval / approved /
ready_to_bill / billed. cancelled is terminal.
```

- **Draft is not a database state.** The cart lives in `localStorage` until submit (see [salesman-app.md](salesman-app.md)). The accountant never sees half-built orders, abandoned carts burn no order numbers, and there are no draft rows to purge or secure.
- **Locked is a derived condition, not a status:**

```
locked_for_salesman(order) :=
    status IN ('approved', 'ready_to_bill', 'billed', 'cancelled')
 OR (status = 'pending_approval' AND now() >= editable_until)
```

## Transitions

| Transition | Actor | Guards | Side effects |
|---|---|---|---|
| *(client draft)* → `pending_approval` via `submit_order` | owning salesman | ≥1 line; every product active (+priced for fixed brands; manual brands take the salesman's price, > 0 ≤ ceiling); qty 1–9999; retailer exists; one brand per order | Assign `order_no` + `order_ref`; `submitted_at = now()`; `editable_until = now() + EDIT_WINDOW`; snapshot lines; event `submitted`. Idempotent on client-generated `id`: a retry with an existing `id` returns that order untouched (safe double-tap / retry-after-timeout). |
| `pending_approval` → `approved` via `approve_order` | **admin only** | brand has `requires_scan = true` (LG) | `approved_at/by`; event `approved`; **beats the timer** — salesman locked out immediately. Godown queue picks it up. |
| `pending_approval` → `ready_to_bill` via `approve_order` | **admin only** | brand has `requires_scan = false` (fixed) | Same stamps + event `approved` — the scan step simply doesn't exist for this brand. |
| `approved` → `ready_to_bill` via `submit_pick` | **godown only** | full per-line serial coverage; within-bill serial uniqueness | `picked_at/by`; scan rows; event `picked`. |
| `approved` → `billed` via `process_order` | accountant / admin | — | **The override**: bill an LG order without the godown step. `processed_at/by` (plumbing column names); event `billed`. |
| `ready_to_bill` → `billed` via `process_order` | accountant / admin | — | The normal billing path. Same stamps/event. |
| `pending_approval` → `cancelled` via `cancel_order` | owning salesman **while editable**; accountant/admin any time | reason required from staff | `cancelled_at/by`; event `cancelled` (+reason). Salesman self-cancel is reason-free and hidden from his list (D8). |
| `approved` / `ready_to_bill` / `billed` → `cancelled` via `cancel_order` | accountant / admin only | reason required | Event logged; scan rows are **kept** (audit). Tally reversal is the accountant's manual job. |

`process_order` on a `pending_approval` order is **rejected** ("must be approved before it can be billed"). Everything else is illegal and rejected by the `guard_order_transition` trigger (including any resurrection of `cancelled` and any status write outside the RPCs). `→ ready_to_bill` is role-checked in the guard itself: from `approved` only godown, from `pending_approval` only admin.

## Editing rules

| Order condition | Owning salesman | Accountant / admin |
|---|---|---|
| `pending_approval`, `now() < editable_until` | May edit **items and notes** (not the retailer) via `update_order_items`; may self-cancel (reason-free). | May edit, cancel (reason). Only the **admin** may approve. |
| `pending_approval`, past window | Read-only. | May edit **with a required reason** (`edited_after_lock`), cancel. Admin may approve. |
| `approved` / `ready_to_bill` / `billed` | Read-only. | May edit with a required reason (`edited_after_lock`); may bill (`approved`/`ready_to_bill`); may cancel with reason. |
| `cancelled` | Read-only. | Read-only. |

- **Snapshot semantics on edit:** surviving lines keep their **original** snapshot price (the price at order time is the deal); newly added lines snapshot at edit time (fixed brands) or take the entered price (manual brands). Totals recomputed server-side. `update_order_items` diffs by `product_id` — never delete-all-and-reinsert.
- **Concurrency:** last-write-wins within the window (D6); every write lands in `order_events`. Approval or billing during an in-flight salesman edit wins — his next write is rejected by the guards.

## The edit window

- **2 hours** from submission, stored per-order in `editable_until` (historical orders keep the policy they were submitted under).
- Compared against `now()` **in Postgres** — never the phone's clock.
- The chip shows a live countdown while `pending_approval`; **approval ends the window early** for every brand (admin sign-off beats the timer, exactly as billing always did).

## Numbering

- `order_no` from `order_no_seq` (starts 1001), consumed **at submit only**.
- `order_ref = 'ORD-' || <brand code> || '-' || order_no` → `ORD-LG-1042` (year segment dropped 2026-07-10; the global sequence alone is unique).
- Unique and monotonic, **not gapless** (D1). Statutory invoice numbers are Tally's job.

## Event catalog (`order_events.action`)

| action | actor | details payload |
|---|---|---|
| `submitted` | salesman | `{ item_count, total_paise, manual_priced? }` — the *placement* event; still fires (and still reads "Submitted by …") even though there is no `submitted` **status** |
| `approved` | admin | `{}` — fires for every brand (routing to `approved` or `ready_to_bill` is invisible to the event) |
| `picked` | godown | `{ scan_count }` |
| `items_changed` | salesman (within window) / staff | `{ before: [...], after: [...] }` |
| `edited_after_lock` | accountant/admin | `{ before: [...], after: [...], reason }` — `reason` required |
| `billed` | accountant/admin | `{}` — was `processed` before 2026-07-10; historical events were backfilled |
| `cancelled` | either | `{ reason? }` (required from staff) |
| `retailer_quick_added` | salesman | `{ retailer_id, name }` |

`before`/`after` arrays hold `{ tally_name, qty, unit_price_paise }` — human-readable dispute trail. (Events before M5.5 used a `sku` key; the reader accepts either.)

## Edge cases

- **Retailer changes mind minutes after the salesman leaves** → salesman edits within the window — *unless the admin already approved*, which locks it (call the office).
- **Retailer changes mind next day** → accountant edits or cancels with a reason; app trail + manual Tally correction.
- **Two devices, same salesman** → last write wins within the window; events record both.
- **Product deactivated/re-priced between submit and edit** → surviving lines keep their snapshot; the product can't be *newly added* if unpriced (fixed) / inactive.
- **Admin unavailable** → orders queue in `pending_approval`; the accountant can neither approve nor bill them (owner-accepted bottleneck, revisit if it bites).
