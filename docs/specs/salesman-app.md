# Spec — Salesman App (mobile-first)

The salesman's entire job in the app: pick the shop, punch quantities, submit, and fix mistakes within the window. Success metric: a 5–8 line order in **under 90 seconds**, one-handed, on a mid-range Android over spotty 4G. The notebook is the competitor.

## Flow

```
Login → Home (My Orders) → New Order → Pick Retailer → Quick Order List
      → Review → Submit → Confirmation (ref) → back to Home
                                   ↑
        Edit (while editable) ─────┘  (reopens the same Quick Order list)
```

## Screens

### 1. Login (`/login`)
Email + password, "remember me" default on (long-lived session). No signup, no social buttons, no forgot-password self-service (admin resets, D3). Error state: wrong credentials, deactivated account.

### 2. Home — My Orders (`/`)
- Primary action: **"New Order"** — big, thumb-reachable.
- List of the salesman's orders, newest first: `order_ref`, retailer name, line count, `total`, status chip, and — while editable — a **live countdown** ("editable 1h 12m").
- Status chips: `Submitted` (editable) / `Submitted · locked` (derived, past window) / `Processed` / `Cancelled`.
- Tap → Order detail. Empty state for a fresh account. "Today" section separated from older orders (IST days).

### 3. Pick Retailer
- Search-as-you-type over `name` + `area`; **recent retailers first** (this salesman's last N orders).
- **Quick-add**: name (required), area, phone → creates `verified = false` retailer and proceeds straight into the order. Flagged "new — pending verification" so the accountant reviews it later ([accountant-dashboard.md](accountant-dashboard.md)).
- A resumable local draft for a retailer surfaces here: "Continue order for Sharma Electronics?"

### 4. Quick Order List — the hero screen
- **Dense list grouped by category** (Adaptors, Adaptors with Cable, Charging Cables, Earphones, Power Banks, Speakers), category headers sticky-ish, CSV order preserved within groups.
- **Row = product name (up to 2 lines) + price + stepper** `[−] qty [+]`. Tapping the qty number opens a numeric keypad for direct entry (typing 24 beats tapping + 24 times). Rows with qty > 0 are visually distinct.
- **Sticky search bar** (top): instant, client-side, case/space-insensitive substring match over name + sku ("astra" → ASTRA 40). Clearing restores the grouped list. No network round-trip.
- **Sticky cart bar** (bottom): `3 items · ₹2,584 — Review ▸`. Always visible once qty > 0. Item count = distinct lines.
- Catalog = `active AND priced` products only (RLS guarantees it; ~34 rows at launch, no pagination needed). **No product images exist** — this is a text-first design, by constraint and by speed.
- Prices displayed ₹ en-IN, GST-inclusive as-is (D5) — what you see is what the shop pays.

### 5. Review
- Editable line list (qty steppers + remove), retailer confirmation header, **notes** field (free text, 500 chars — "deliver Tuesday", "urgent"), computed total.
- **Submit** → success: Confirmation screen with big `order_ref` + "editable until HH:MM". Failure: see resilience.

### 6. Order detail (`/orders/[id]`)
- Lines (snapshot names/prices), notes, retailer, status + countdown, event history in plain words ("Submitted 11:42", "Edited 12:05 — qty TT27 5→10").
- Buttons while editable: **Edit** (reopens Quick Order pre-filled) and **Cancel** (confirm dialog). After lock: read-only + "call the accountant to change this order".

## Resilience (deliberate scope — see architecture §5)

- Cart **autosaves to `localStorage` on every tap** (key: retailer + client-generated order UUID). Kill the app, lose signal, reboot the phone — the draft survives. Drafts are per-device by design; no server sync (lifecycle spec).
- Submit uses the client-generated UUID → **idempotent**: double-tap or retry-after-timeout cannot create two orders.
- Offline at submit: draft stays local with a visible "not submitted — retry" state; retry with backoff. **No silent loss, no silent duplication — ever.**
- Catalog cached with staleness timestamp; refreshed opportunistically.

## Non-functional

- Interactive in < 2s on a mid-range Android over 4G; search filters in < 50ms (in-memory over ≤100 rows).
- Touch targets ≥ 44px; stepper `+` is the most-tapped control in the app — size it accordingly.
- Works in Chrome Android + Safari iOS. English UI; product names verbatim from the catalog.
- Session persists ~30 days (Supabase default refresh) — a field salesman must ~never see the login screen.

## Acceptance criteria (Phase 1 exit)

1. Stopwatch test: known 6-line order, shop-floor conditions, < 90s from "New Order" to confirmation.
2. Airplane-mode mid-cart → reopen app → draft intact; submit in airplane mode → visible pending state → retry on signal → exactly one order in DB.
3. Double-tap submit → exactly one order row.
4. Countdown reaches 0 → UI flips read-only **and** a forged RPC call is rejected server-side.
5. Salesman never sees an unpriced/inactive product, in list or search.
6. Order detail reconstructs any edit from events, in words the owner can read to a retailer over the phone.
