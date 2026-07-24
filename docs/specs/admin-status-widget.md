# Admin status widget — spec v1 (2026-07-24)

Owner-approved design for a phone home-screen widget showing order-status counts at a glance. Primarily for the admin (iPhone). A **companion artifact** — it consumes one app endpoint but does not ship with the app.

**Status: DESIGN LOCKED (this doc). Build NOT scheduled — owner prioritized the notification system first (2026-07-24).**

## Decisions (owner, 2026-07-24)

- **D1 — Platform path: Scriptable.** Free iOS app; our ~100-line JS script runs inside it and renders the widget. No native app, no Apple developer account. (PWAs cannot register widgets on either OS — hard platform fact.) Android later: the same endpoint feeds KWGT or a tiny sideloaded APK; nothing widget-specific in the app.

- **D2 — Data is PULL-only.** The widget wakes on the OS's schedule (~5–15 min, iOS decides) and GETs the status endpoint. No webhook/push variant exists — a widget cannot receive inbound calls. The tile is a glanceable summary, **not** live.

- **D3 — Endpoint: `GET /api/widget/status`.** Aggregate counts only — per-status open counts + "billed today" / "dispatched today". No money totals, no PII, no order refs. Gated by a long random token, password-grade, **only its hash stored** (mirror the stock-push-secret pattern). Code-only; no DB change.

- **D4 — Size: LARGE (4×4), TWO rows of rings** so more than four statuses fit. (Owner call 2026-07-24; supersedes the single-row 4×2 mock iterations.)

- **D5 — Style: battery-ring** (modeled on the iOS Batteries widget). Per status: a colored ring with an icon inside, the count beneath. Deep-ink tile (`#1b1c24 → #0e0f13` gradient), saffron-gold gradient `GANPATI` wordmark, **one committed look** on any wallpaper. No background glow. **No timestamp** on the tile.

- **D6 — Ring fill = that status's share of the open pipeline** (3 pending of 7 open ≈ half a ring) — the glance shows *where work piles up*, not just counts. Zero = dim empty ring, dimmed icon + count.

- **D7 — Status colors/icons** (row 1, left→right = order lifecycle):
  | status | color | icon |
  |---|---|---|
  | pending approval | gold `#f0a839` | clock |
  | to pick | teal `#4fb8a8` | box |
  | ready to bill | green `#5fc26e` | receipt |
  | backorders | coral `#ff8d7e` | return-arrow |

  **Coral is reserved as the only alert color.** Row-2 composition (slots 5–8) is **OPEN** — candidates: billed today, dispatched today, deposits today, cancelled today. (The 4-slot rule "backorder slot swaps to billed-today full gold ring when zero backorders" was accepted for the one-row mock; likely moot with 8 slots.)

- **D8 — No tap destination.** iOS forbids a fully dead tap; with no widget URL set, a tap lands in the Scriptable app itself — never Safari. Reason: iOS cannot deep-open a PWA by URL, and Safari holds a *separate* login from the installed PWA; owner rejected Safari as a landing surface.

- **D9 — Labels variant** (tiny uppercase labels under counts) exists for the onboarding weeks; pure icon+count is the end state.

## Build plan (when scheduled)

1. `GET /api/widget/status` — BUILDER; token check + counts query. No DB change.
2. `tools/widget/ganpati-status.js` — the Scriptable script, checked into the repo for versioning/review. Rings drawn via DrawContext (the community's battery-clone widgets prove the exact technique).
3. Phone setup (~5 min): install Scriptable → paste script + token → add large widget → select script.

## Reference

Design iterated 2026-07-24 via session mocks: plain white tile → gold-on-ink full-width → battery rings (chosen). Two-row large-size mock not yet drawn — deferred with the build, behind notifications.
