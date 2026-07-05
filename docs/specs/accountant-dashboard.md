# Spec — Accountant Dashboard (desktop-first)

The accountant's command center: see orders the moment they land, lock them before booking into Tally, correct them with a trace, and hand the godown a legible pick slip. Desktop Chrome, keyboard-friendly, information-dense.

## Screens

### 1. Orders list (`/dashboard`)
- Table, newest first: `order_ref` · submitted time (IST, "11:42" / "Yesterday 16:03") · salesman · retailer (+ "NEW" badge if unverified) · line count · total · status chip · editable-countdown (if running).
- **Live**: new orders appear via Supabase Realtime without refresh, with a brief highlight. (Polling every 30s is an acceptable fallback — D6.)
- Filters: status, salesman, date (IST buckets: Today / Yesterday / range). Search by ref or retailer.
- Row click → Order detail. Bulk selection is **not** Phase 1 (revisit with Tally export in Phase 2).

### 2. Order detail
- Header: ref, status, retailer (with phone), salesman, submitted/processed timestamps, countdown if editable.
- Lines: name (snapshot), qty, unit price, line total; order total. Notes prominent — they carry delivery instructions.
- **Event timeline**: every event from `order_events`, humanized ("Submitted 11:42 by Raju", "Edited after lock 14:20 by Accountant — TT27 qty 5→10, reason: shop called").
- Actions:
  - **Mark processed** — the lock. One click + confirm. Sets `processed_at/by`; salesman goes read-only instantly. Meaning: "I am booking this into Tally now."
  - **Edit order** — opens line editor (same semantics as `update_order_items`; after the window it requires a reason and logs `edited_after_lock`). Surviving lines keep their snapshot price; added lines snapshot now.
  - **Cancel** — reason required, confirm dialog.
  - **Print pick slip** — below.

### 3. Print pick slip (the godown handoff)
Print-CSS view (no PDF library needed), one order per A4 page:

```
GANPATI ENTERPRISES — PICK SLIP
ORD-2026-1042            Submitted: 06 Jul 2026, 11:42
Retailer: Sharma Electronics, Sadar Bazaar   Ph: 98xxx
Salesman: Raju

  QTY   ITEM
  ───   ─────────────────────────────────────────────
   10   Micro Usb Cable MU240 - ZB CABLE (White)
    5   ADAPTOR (MA104B WHITE) ZEB
    2   SPK-PSPK 44 PORTABLE BTH SPEAKER (ASTRA 40)

Notes: deliver Tuesday morning

Packed by: ____________   Checked by: ____________
```

- **Qty column first and huge** (the godown reads quantities, not prices). Prices are **off by default**, toggle to include (turns it into an order copy for the retailer).
- ≥ 12pt body, qty ≥ 16pt; sensible with 1–20 lines. Paper size default A4 (open question: thermal/A5 — see PLAN).

### 4. Retailers (`/dashboard/retailers`)
- List with `verified` filter; **verification queue** surfaces salesman quick-adds: edit name/area/phone (canonical spelling — this becomes the Tally ledger mapping in Phase 2), then mark verified. Deactivate (never delete) dead shops.

### 5. Catalog administration — deliberately not built in Phase 1
Pricing the 8 TBD SKUs, price revisions, and deactivating products happen in **Supabase Studio** (table editor) with the admin/accountant logged in. A dedicated in-app catalog screen is deferred until Studio actually hurts. Setting `price_paise` on a TBD SKU makes it appear to salesmen immediately (D2) — no deploy, no restart.

## Non-functional

- Target ≥ 1280px; must remain usable at 1024. No mobile layout required in Phase 1 (the accountant works at a desk).
- Times in IST everywhere; "Today" = IST calendar day.
- Keyboard: `/` focuses search; Enter opens selected row. (Small, but this user lives in Tally — keyboard speed is respect.)

## Acceptance criteria (Phase 1 exit)

1. Order submitted on a phone appears on an already-open dashboard within 5s, no refresh.
2. Mark processed → salesman's app is read-only for that order within one interaction (and forged salesman RPC rejected).
3. Post-lock edit requires a reason and shows up in the timeline with before/after.
4. Pick slip prints legibly on A4 from Chrome; qty column readable at arm's length.
5. A quick-added retailer shows NEW badge → verify flow cleans the name → badge clears; order history for that shop is preserved.
6. The accountant (a Tally power user, not a web-app person) completes see → print → process on her own after one demonstration.
