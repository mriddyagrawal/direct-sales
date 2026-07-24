# Push notifications — spec v1 (2026-07-25)

Web-push notifications for the installed PWA, all four roles, iOS + Android + desktop Chrome.

**Status: DESIGN APPROVED (owner, 2026-07-24 → 25). Build not started.**
**⚠️ Contains exactly one DB change** (`push_subscriptions` table + event webhooks) — per the prod-caution rule this needs the owner's explicit go at build time. Everything else is code-only.

## Ground rules

- **R1 — Never notify the actor** of their own action.
- **R2 — Admin cancellations are silent** to everyone. Owned consequence: the salesman is *not* told when the admin cancels his order. Deposit voids are exempt — an admin void still notifies the salesman.
- **R3 — Everything rings.** No silent tier (owner call; iOS forbids silent web pushes anyway).
- **R4 — Every registered device per user** — phones, tablets, desktop Chrome. The office/Tally computer gets the same notifications as toasts.
- **R5 — Salesmen only ever hear about their own** orders/deposits. Recipient scoping mirrors RLS.
- **R6 — Clear-on-open:** the moment the app opens/foregrounds, the service worker closes every notification it has shown and recomputes the badge. Per-device only — cross-device read-sync does not exist for web push. iPhone behavior goes on the real-device acceptance list.
- **R7 — No action buttons in v1.** Tap-to-open only (approve-from-lockscreen is a mistake generator; iOS has no buttons regardless).

## Matrix (v3 — final)

| Event | Admin | Salesman | Godown | Accountant |
|---|---|---|---|---|
| Submitted | ✅ | — (own) | — | ✅ |
| Order edited (pending) | ✅ | ✅ *if not actor (proposed)* | — | ✅ |
| Approved | — (actor) | ✅ | ✅ new pick | ✅ |
| Backordered | ✅ | ✅ | — | ✅ |
| Picked / ready to bill | ✅ | — | — | ✅ their Tally job |
| Billed | ✅ | ✅ bill ready | ✅ ready to dispatch | — (actor) |
| Dispatched | ✅ | ✅ | — (actor) | ✅ |
| Cancelled — non-admin actor | ✅ | ✅ | ✅ if pick/dispatch pending | ✅ (any state) |
| Deposit recorded | ✅ | — (own) | — | ✅ |
| Deposit voided | ✅ | ✅ | — | — |
| New retailer (needs verification) | ✅ | — (own) | — | ✅ |

Non-events: admin cancels (R2) · `stepped_back` (admin tool — silent) · manual reinstates. A **punched backorder** fires the ordinary Submitted row (`details.punched=true`; body may say "punched backorder").

## Anatomy

**Emoji code** — fixed, leading, always the same per event (the lockscreen becomes scannable): 🛒 new order · ✏️ edited · ✅ approved · 📦 pick/picked · ⚠️ backordered · 🧾 billed / bill ready · 🚚 ready-to-dispatch / dispatched · ❌ cancelled · ₹ deposits · 🏪 retailer.

**Title:** `<emoji> <Event> — <Retailer>`. **₹ appears in the title only for deposits** (owner call); order amounts live on body line 1.

**Body line 1 (collapsed) = triage numbers:** `₹11,425 · 3 items · Zebronics · by Bheeshm`.

**Second page** (Android pull-down, iOS long-press — same payload):

| Card | Expanded content |
|---|---|
| 🛒 New order | Item list `2× WM 7kg`… with **⚠️ on lines already out of stock** — approve knowing what will backorder |
| ✏️ Edited | The order's new shape: item list + new total |
| ✅ Approved | Item list (salesman re-confirms to retailer) |
| 📦 New pick | The pick list — name × qty per line |
| 📦 Picked | Per-line tally `2/2 ✓` / `0/2 → backorder`, ends with child backorder ref |
| ⚠️ Backordered | Same per-line picked-vs-short breakdown |
| 🧾 Billed / Bill ready | Billed items only + `backordered separately: … (ref)` |
| 🚚 Ready to dispatch | Item list + bill number |
| 🚚 Dispatched | Dispatch note verbatim, if written |
| ❌ Cancelled | Reason verbatim + item count |
| ₹ Deposit / voided | Note field; voids: reason + deposit ref |
| 🏪 New retailer | Area · phone · by whom |

Cap ~5 detail lines then `+N more`; expanded always ends with the ref. Money en-IN from paise, everywhere.

**Collapse:** `tag` = order id → Android replaces in place (one live card per order); every replacement rings (R3). iOS ignores tags and stacks by app — accepted.

**TTL** (Web Push relay header, honored by both Google's and Apple's relays): job cards (📦 new pick, 🚚 ready to dispatch) ≈ 4 h; everything else 24 h. A stale job push dies at the relay instead of arriving after the work is done.

**Badge** = the role's open-jobs count, updated with each push + recomputed on open: admin = pending approvals · accountant = ready to bill · godown = open picks + to-dispatch · salesman = none (no queue).

**Vibration:** platform default. Distinct money-buzz = parked v2 toggle.

## Copy catalog (collapsed lines)

| Card | Title | Body L1 |
|---|---|---|
| 🛒 | New order — Sharma Electronics | ₹11,425 · 3 items · Zebronics · by Bheeshm |
| ✏️ | Order edited — Sharma Electronics | ORD-ZB-1240 · now 4 items · ₹13,200 · by Bheeshm |
| ✅ | Order approved — Sharma Electronics | ORD-ZB-1240 · ₹11,425 · by Vikram |
| 📦 | New pick — Zebronics | 3 items · ORD-ZB-1240 · Sharma Electronics |
| ⚠️ | Backordered — Sharma Electronics | ORD-LG-1232 · full backorder · by Suresh |
| 📦 | Picked — Sharma Electronics | 5/7 items · 2 short → backorder |
| 🧾 | Billed — Sharma Electronics | Bill #2841 · ₹11,425 · by Meena |
| 🧾 | Bill ready — Sharma Electronics | ORD-ZB-1240 · Bill #2841 |
| 🚚 | Ready to dispatch — Sharma Electronics | ORD-ZB-1240 · 3 items · billed ✓ |
| 🚚 | Dispatched — Sharma Electronics | ORD-ZB-1240 · on its way |
| ❌ | Cancelled — Sharma Electronics | ORD-ZB-1240 · by Bheeshm · "reason" |
| ₹ | Deposit ₹5,000 — Sharma Electronics | Cash · by Bheeshm |
| ₹ | Deposit voided — Sharma Electronics | ₹5,000 cash · by Bheeshm · "reason" |
| 🏪 | New retailer — Agarwal Traders | Sadar Bazar · by Bheeshm |

Role framings of one event stay distinct cards where the *job* differs (godown always job-framed; accountant's picked = "Ready to bill"); otherwise roles share the identical card. Deep link per card = the role's canonical screen for it (admin/acct → dashboard order detail; salesman → his order; godown → pick screen / order; 🏪 → verification queue). Builder pins exact routes.

## Pipeline

`order_events` / `deposit_events` / `retailers` INSERT → **Supabase DB webhook** → **Edge Function `notify`** → resolve recipients (matrix × R1/R2/R5) → fetch `push_subscriptions` → Web Push (VAPID; TTL class; tag; badge count) → prune dead subscriptions on 404/410.

**⚠️ The DB change (build-time approval):** `push_subscriptions` (id, user_id → profiles, endpoint unique, p256dh, auth, device_label, created_at, last_seen_at), RLS owner-only, + webhook config. Nothing else touches the DB.

Client: `sw.js` (today a passthrough) gains `push`, `notificationclick` (focus-or-open at the deep link), clear-on-open (R6), Badging API. Enable-UX: one-time per-role prompt card after login + a persistent re-enable row (placement at build). Env: VAPID key pair (public → client, private → Edge Function secret). iOS prerequisite: installed PWA, iOS 16.4+, permission granted via user gesture.

## Acceptance (build-time)

1. Real iPhone (the admin's): receive + ring, tap deep-links into the standalone PWA, badge counts, clear-on-open, long-press second page.
2. Android: same, plus tag replacement (one evolving card per order) and pull-down expansion.
3. Desktop Chrome toast + click-through.
4. Actor suppression live (approve as admin → admin's own devices stay silent).
5. **Cross-salesman isolation: salesman B receives nothing for A's order** — push-side RLS parity, non-negotiable.
6. TTL: a phone offline past a job card's TTL receives nothing on reconnect.
7. Content spot-checks: partial-pick per-line tallies, ⚠️ stock flags on new-order, billed-vs-backordered split, void reasons.

## Parked (v2+)

Money-vibration toggle · quiet hours · per-category user preferences · daily digest · salesman badge.

**The native-shell unlock:** one thin Swift wrapper app + Apple's $99/yr would buy, in a single decision: real WidgetKit widgets (upgrade of [admin-status-widget.md](admin-status-widget.md)'s Scriptable path), **Live Activities** (Domino's-style live lockscreen order card — the order lifecycle submitted → approved → picked → billed → dispatched fits it perfectly), iOS notification action buttons, custom sounds. Revisit when the app's centrality justifies it.

## Owner decisions log

- 2026-07-24: matrix v1 → v2 (godown billed row; accountant first-class; all-devices), accountant-approval myth corrected (DB: only admin approves), void-window verified (creator 1 h / admin anytime).
- 2026-07-25: all-ring (no silent tier) · badge in · emoji code in · ₹-in-title deposits-only · second-page table incl. ⚠️ stock flags · clear-on-open + per-device boundary · TTL in · buttons out (v1) · retailer-verification pushes IN · **order-edit pushes IN (owner, against reviewer's lean)** · native-shell note parked.
