# Spec — Order Lifecycle

The state machine, the edit window, numbering, and the audit-event catalog. Enforcement is server-side (RPCs + triggers + RLS) — the UI only mirrors these rules.

## States

```
 (client-side draft)                        ┌────────────┐
  localStorage only ──── submit_order ────▶ │ submitted  │ ──── process_order ────▶ ┌───────────┐
  never in Postgres                         │            │                          │ processed │
                                            └─────┬──────┘                          └─────┬─────┘
                                                  │ cancel_order                          │ cancel_order
                                                  ▼                                       ▼ (accountant, reason)
                                            ┌────────────┐                         ┌───────────┐
                                            │ cancelled  │                         │ cancelled │
                                            └────────────┘                         └───────────┘
```

- **Draft is not a database state.** The cart lives in `localStorage` until submit (see [salesman-app.md](salesman-app.md)). Consequences: the accountant never sees half-built orders, abandoned carts burn no order numbers, and there are no draft rows to purge or secure. (Early planning drafts had `DRAFT` and `LOCKED` as stored statuses — corrected; see graveyard in [decisions.md](../decisions.md).)
- **Locked is a derived condition, not a status:**

```
locked_for_salesman(order) :=
    status = 'processed'
 OR status = 'cancelled'
 OR (status = 'submitted' AND now() >= editable_until)
```

## Transitions

| Transition | Actor | Guards | Side effects |
|---|---|---|---|
| *(client draft)* → `submitted` via `submit_order` | owning salesman | ≥1 line; every product active + priced; qty 1–9999; retailer exists | Assign `order_no` (sequence) + `order_ref`; `submitted_at = now()`; `editable_until = now() + EDIT_WINDOW`; snapshot lines from catalog; event `submitted`. Idempotent on client-generated `id`: a retry with an existing `id` returns that order untouched even if the retried payload differs (safe double-tap / retry-after-timeout). |
| `submitted` → `processed` via `process_order` | accountant / admin | — (any time after submit; does **not** wait for the window) | `processed_at/by`; event `processed`. Salesman is locked out immediately — processing beats the timer. |
| `submitted` → `cancelled` via `cancel_order` | owning salesman **while editable**; accountant/admin any time | accountant must supply a reason | `cancelled_at`; event `cancelled` (+reason). |
| `processed` → `cancelled` via `cancel_order` | accountant / admin only | reason required | Event logged. Any corresponding Tally reversal is the accountant's manual job — out of app scope. |

Everything else is illegal and rejected by the `guard_order_transition` trigger (including `processed → submitted`, any resurrection of `cancelled`, and any status write outside the RPCs).

## Editing rules

| Order condition | Owning salesman | Accountant / admin |
|---|---|---|
| `submitted`, `now() < editable_until` | May edit **items and notes** (not the retailer — cancel and re-order instead) via `update_order_items`; may cancel. | May edit, process, cancel. |
| `submitted`, past window | Read-only. | May edit (event `edited_after_lock`, with before/after in `details`), process, cancel. |
| `processed` / `cancelled` | Read-only. | `processed`: may still edit with `edited_after_lock` event (e.g. retailer phoned a correction that's already in Tally — the trail is what matters); may cancel with reason. |

- **Snapshot semantics on edit:** lines that survive an edit keep their **original** snapshot price (the price at order time is the deal); newly added lines snapshot the catalog price at edit time. Totals recomputed server-side. **Implementation pin (review flag):** the naive delete-all-and-reinsert re-snapshots survivors at *current* catalog prices, silently violating this rule — `update_order_items` must diff by `product_id`, updating qty on survivors (snapshot columns untouched) and inserting only genuinely new lines. Dedicated test required: submit → change the catalog price → edit qty → the line still shows the original price.
- **Concurrency:** at this scale (D6) last-write-wins within the window is acceptable; every write lands in `order_events`, so nothing is ever silently lost. `process_order` during an in-flight salesman edit wins — the salesman's next write is rejected by the guards.

## The edit window

- **Default: 2 hours** from submission (owner to confirm — open question in [PLAN.md](../../PLAN.md)).
- Defined as a constant inside `submit_order`; changing it is a one-line migration and affects only future orders.
- Stored per-order in `editable_until` so historical orders keep the policy they were submitted under.
- Compared against `now()` **in Postgres** — never against the phone's clock. Timezone-safe by construction (`timestamptz`, UTC).
- UI shows a live countdown ("editable for 1h 12m") derived from `editable_until`; expiry flips the UI read-only, and the RPC guard is what actually enforces it.

## Numbering

- `order_no` from `order_no_seq` (starts 1001), consumed **at submit only** — drafts never burn numbers.
- `order_ref = 'ORD-' || <IST year of submitted_at> || '-' || order_no` → `ORD-2026-1042`. The year is cosmetic context; `order_no` alone is the unique key and does not reset at year end.
- Unique and monotonic, **not gapless** (D1): a rolled-back transaction or a cancelled order leaves a gap, by design. Statutory invoice numbers are Tally's job.
- No brand code in the ref (D4): an order's brand is a property of its items.

## Event catalog (`order_events.action`)

| action | actor | details payload |
|---|---|---|
| `submitted` | salesman | `{ item_count, total_paise }` |
| `items_changed` | salesman (within window) | `{ before: [...], after: [...] }` |
| `edited_after_lock` | accountant/admin | `{ before: [...], after: [...], reason? }` |
| `processed` | accountant/admin | `{}` |
| `cancelled` | either | `{ reason? }` (required from accountant) |
| `retailer_quick_added` | salesman | `{ retailer_id, name }` — logged on the first order for an unverified retailer |

`before`/`after` arrays hold `{ sku, qty, unit_price_paise }` — enough to reconstruct any dispute without archaeology. (`order_items` doesn't store `sku`, so the RPCs join `products` at event-write time — do not "simplify" payloads to bare `product_id`s; the trail must stay human-readable.)

## Edge cases

- **Retailer changes mind minutes after the salesman leaves** → salesman edits within the window from the shop doorstep. This is the scenario the window exists for.
- **Retailer changes mind next day (order processed, maybe delivered)** → accountant edits or cancels with a reason; app trail + manual Tally correction.
- **Submit at 11:59pm Dec 31** → ref year = IST year of submission; nothing else special.
- **Two devices, same salesman** → last write wins within the window; events record both.
- **Product deactivated/re-priced between submit and edit** → surviving lines keep their snapshot; the product simply can't be *newly added* if now unpriced/inactive.
