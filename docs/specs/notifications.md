# Push notifications — spec v1.1 (2026-07-25)

Web-push notifications for the installed PWA, all four roles, iOS + Android + desktop Chrome.

**Status: DESIGN APPROVED (owner, 2026-07-24 → 25); *builder round 1 folded in full, 2026-07-25 — webhook auth, verified-false retailer guard, dual edit actions, `commented` + deposit-void rulings, renotify/badge/duplicate pins, ops checklist, build order.* Build not started.**
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
| Order edited — *the TWO actions `items_changed` AND `edited_after_lock`; builder must wire both* | ✅ | ✅ if not actor | — | ✅ |
| Admin note (`commented`) — *owner ruling 2026-07-25* | — (actor) | ✅ | — | ✅ |
| Approved | — (actor) | ✅ | ✅ new pick | ✅ |
| Backordered | ✅ | ✅ | — | ✅ |
| Picked / ready to bill | ✅ | — | — | ✅ their Tally job |
| Billed | ✅ | ✅ bill ready | ✅ ready to dispatch | — (actor) |
| Dispatched | ✅ | ✅ | — (actor) | ✅ |
| Cancelled — non-admin actor | ✅ | ✅ | ✅ if pick/dispatch pending | ✅ (any state) |
| Deposit recorded | ✅ | — (own) | — | ✅ |
| Deposit voided | ✅ | ✅ | — | ✅ *(owner ruling 2026-07-25 — she reconciles the drawer; a void shrinks the day's total after the fact)* |
| New retailer (needs verification) — *fires ONLY on `verified = false` inserts; bulk imports insert `verified = true` and stay silent (storm guard)* | ✅ | — (own) | — | ✅ |

Non-events: admin cancels (R2) · `stepped_back` (admin tool — silent) · manual reinstates · **deposit edits within the 1-hour window** *(explicit non-event — the DB logs no event for them today, so there is nothing to hook and nothing missed)*. A **punched backorder** fires the ordinary Submitted row (`details.punched=true`; body may say "punched backorder").

## Anatomy

**Emoji code** — fixed, leading, always the same per event (the lockscreen becomes scannable): 🛒 new order · ✏️ edited · 💬 office note · ✅ approved · 📦 pick/picked · ⚠️ backordered · 🧾 billed / bill ready · 🚚 ready-to-dispatch / dispatched · ❌ cancelled · ₹ deposits · 🏪 retailer.

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

**Collapse:** `tag` = order id → Android replaces in place (one live card per order); every replacement rings (R3) — *which silently depends on `renotify: true` being set on every push; without it a tag replacement is mute. Pinned so R3 can't be broken by an omitted flag.* iOS ignores tags and stacks by app — accepted.

**TTL** (Web Push relay header, honored by both Google's and Apple's relays): job cards (📦 new pick, 🚚 ready to dispatch) ≈ 4 h; everything else 24 h. A stale job push dies at the relay instead of arriving after the work is done.

**Badge** = the role's open-jobs count, updated with each push + recomputed on open: admin = pending approvals · accountant = ready to bill · godown = open picks + to-dispatch · salesman = none (no queue). *The on-open recompute reads the TanStack query cache Slice B just shipped — the orders list already refetches on focus, so the count falls out of cached rows for free; no new endpoint.*

**Vibration:** platform default. Distinct money-buzz = parked v2 toggle.

**Iconography (owner 2026-07-25): the notification always wears the app's real logo** (`assets/favicon.png` receipt-glyph), never a bespoke mark. iOS: automatic — web push always shows the installed PWA's manifest icon (note: iOS home icons can't be transparent; Apple flattens them). Android `icon`: the logo **with transparent background** (clean on light + dark shades). Android `badge` (status-bar glyph): a dedicated **96×96 white-on-transparent silhouette** of the receipt glyph — Android tints silhouettes, full-color turns to grey smudge. That silhouette is the only new icon asset the build needs.

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
| 💬 | Note from the office — Sharma Electronics | ORD-ZB-1240 · note text on the second page |

Role framings of one event stay distinct cards where the *job* differs (godown always job-framed; accountant's picked = "Ready to bill"); otherwise roles share the identical card. Deep link per card = the role's canonical screen for it (admin/acct → dashboard order detail; salesman → his order; godown → pick screen / order; 🏪 → verification queue). Builder pins exact routes.

## Pipeline

`order_events` / `deposit_events` / `retailers` INSERT → **Supabase DB webhook** → **Edge Function `notify`** → resolve recipients (matrix × R1/R2/R5) → fetch `push_subscriptions` → Web Push (VAPID; TTL class; tag + `renotify: true`; badge count) → prune dead subscriptions on 404/410.

**Webhook authentication (MUST — *builder catch, 2026-07-25: unauthenticated as first specced, anyone with the function URL could spam fake "New order" pushes*):** the DB webhook sends a shared-secret header; the function rejects any request without the exact match, before parsing. Secret is password-grade — lives only in the webhook config + the function's secret store, never in the repo.

**Delivery semantics:** Supabase webhooks are **at-least-once** — a rare duplicate push is possible and *accepted* at our volume (Android's tag collapse absorbs it; an occasional iOS double is tolerable). No dedupe machinery in v1; noted so nobody builds it reflexively later.

**⚠️ The DB change (build-time approval):** `push_subscriptions` (id, user_id → profiles, endpoint unique, p256dh, auth, device_label, created_at, last_seen_at), RLS owner-only, + webhook config. Nothing else touches the DB.

Client: `sw.js` (today a passthrough) gains `push`, `notificationclick` (focus-or-open at the deep link), clear-on-open (R6), Badging API. **Enable-UX (owner simplification, 2026-07-25): a state-aware BELL in the header ONLY** — TopStrip on the phone shells, dashboard header for staff. *(v1.1 had per-role soft-ask cards at value moments + dismissal cadence; owner cut them: at 4–5 known users, onboarding is verbal — "tap the bell, hit Allow" — and the cards' conversion machinery (dismissal tracking, re-show cadence, per-role copy) buys nothing. The bell keeps the load-bearing properties: the native one-shot dialog fires only on a deliberate tap (iOS gesture rule satisfied, prompt can't burn accidentally), and its states are: default → tap fires the system dialog; granted → bell quiet/hidden + silent subscription self-repair on every open; system-denied → tap opens a short "Settings → Notifications → Ganpati" instruction sheet, never a dead re-prompt. Accepted trade-off on record: nobody is prompted proactively — an untold user never enables.)* Env: VAPID key pair (public → client, private → Edge Function secret). iOS prerequisite: installed PWA, iOS 16.4+, permission granted via user gesture.

## Ops prerequisites (one-time, before commit 1)

1. **VAPID keypair** — generate once; public key → Vercel env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), private key → Edge Function secret. Builder hands the owner the exact commands.
2. **Webhook shared secret** — generate alongside; webhook config header + function secret.
3. **Android badge silhouette** — 96×96 white-on-transparent receipt-glyph, derived from `assets/favicon.png` via a threshold pass; **owner eyeball approves the result** before it ships.

## Build order (commits)

0. **The DB gate** — builder presents the exact `push_subscriptions` + webhook SQL; owner approves; applies as a migration. Nothing else lands first.
1. **Walking skeleton** — Edge Function with the auth check + ONE hardcoded test push, proven end-to-end to the owner's actual iPhone before any matrix code exists. *Front-loads the entire iOS-quirk risk.*
2. **Client side** — sw.js `push`/`notificationclick`/clear-on-open, the header bell (sole enable surface), subscription storage + self-repair.
3. **The matrix** — recipients, copy catalog, second pages, TTL/tag/renotify/badge in the function.
4. **Real-device acceptance pass** (list below).

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
- 2026-07-25 (builder round 1, accepted in full): webhook shared-secret auth (the one must-change) · retailer pushes gated on `verified=false` (bulk-import storm guard) · "edited" pinned to BOTH `items_changed` + `edited_after_lock` · deposit edits declared a non-event · renotify/badge-from-cache/at-least-once pins · ops checklist + build order 0–4. Owner rulings same day: **`commented` → salesman + accountant** (over reviewer's salesman-only lean) · **deposit-void → accountant ✅**. Event vocabulary re-verified against live `order_events`/`deposit_events` by the reviewer — builder's list exact.
