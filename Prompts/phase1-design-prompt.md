# Phase 1 Design Prompt — Ganpati Enterprises Direct Sales

You are designing **Phase 1 of a B2B field-sales order-capture app**. This document is complete and self-contained: every constraint, every screen, and all the real data you need is inside it. There are **zero open questions** — every design decision that was open has been resolved below. Do not ask for the repo, the codebase, or additional context; none is needed.

**Your deliverables** (detailed in §10):
1. High-fidelity designs for **all 11 screens**, including every listed state.
2. A **component & token sheet** (type scale, spacing, color palette with the accent, status chips, steppers, list rows, tables, buttons, form fields, badges).
3. The **pick-slip print layout** (A4 print stylesheet spec).

---

## 1. Context capsule

**Ganpati Enterprises** is a small Indian B2B distributor of consumer-electronics accessories. It supplies retail shops in its territory with several brands; the first brand in scope is Zebronics (~42 SKUs across 6 categories, of which 34 currently have confirmed prices). The team: **1–2 field salesmen**, **one accountant**, godown (warehouse) staff, and the owner. Volume is **under 20 orders a day**; a typical order is 5–8 line items. Statutory invoicing, GST, ledgers, and stock all live in **Tally** (a keyboard-first desktop ERP) and will continue to — this app is a **capture tool, not an ERP**.

**Today's workflow:** a salesman stands in a retailer's shop and writes the order in a notebook while the shopkeeper dictates ("10 of the small cables, 5 adaptors, 2 Astra speakers…"). Hours later the pages reach the accountant, who deciphers the handwriting, matches scribbles against near-identical product names, and re-types the order into Tally. A printed copy goes to the godown for picking. Pain: illegible handwriting, lost slips, hours of latency, double entry, zero visibility, disputes settled by memory.

**Phase 1 replaces the notebook.** Two interfaces:
- A **mobile web app** the salesman uses *inside retail shops*: pick the shop, punch quantities on a fast list, submit, and fix mistakes within a 2-hour grace window.
- A **desktop dashboard** for the accountant: orders appear live the moment they're submitted, she locks each one before booking it into Tally ("Mark processed"), makes traceable corrections, and prints an A4 **pick slip** for the godown.

**The competitor is the paper notebook.** A 5–8 line order must go from "New Order" to confirmation in **under 90 seconds**, one-handed, on a mid-range Android over spotty 4G. Every design choice is judged by: *is this faster than writing it down?* If the app is slower than the notebook, the project has failed regardless of how it looks.

Two things Phase 1 deliberately does **not** do: it does not remove the accountant's typing into Tally (that's Phase 2), and it handles no money (payment stays offline/in Tally).

## 2. Users, devices, viewports

**Raju, field salesman.** Mid-range Android (~₹10k, ~6.1" 720p screen), Chrome. One-handed use; bright daylight outside, dim shops inside; spotty 4G; in a hurry, always. Fluent with WhatsApp-class apps, not "web apps". English UI is fine; product names come verbatim from the catalog (long, ALL-CAPS-ish, occasionally typo'd — that's real data, design for it). His session persists ~30 days; he should almost never see the login screen.

**The accountant.** Desktop Chrome at the office, all day inside Tally — a DOS-lineage ERP that has trained her hands to the keyboard. Wants density, legibility, zero ceremony. Prints paper for the godown. She is a Tally power user, not a web-app person: she must complete see → print → process on her own after one demonstration. Keyboard affordances matter: `/` focuses search, Enter opens the selected row.

**The owner.** Glances at the dashboard; needs status readable at a glance.

**Retailers never see the app.** There is no retailer-facing UI of any kind.

**Design viewports:**
- Mobile baseline: **360×800** (design here; must remain sane on ~6.1" 720p hardware).
- Desktop: **≥1280px** (must remain usable at 1024; no mobile layout needed for the dashboard).
- Print: **A4 portrait**, from Chrome's print dialog (no PDF library).

## 3. The nine design principles (non-negotiable)

1. **Speed over beauty** — but calm, confident utility, not ugliness. A tool, not a consumer app.
2. **Thumb-first mobile**: primary actions in bottom reach; the stepper **[+]** is the most-tapped control in the product — **≥48px touch target**. All touch targets ≥48px.
3. **Text-first**: there are **no product images anywhere in the system — none exist, ever**. Typography carries everything: product name (2-line clamp), price, quantity. Do not design image slots, thumbnails, or placeholder art.
4. **Dense but legible**: ~34 products in one scrolling grouped list is the core screen. Compact rows that remain unmistakably tappable.
5. **Numbers are the content**: prices as ₹ en-IN (`₹9,138`), GST-inclusive (what you see is what the shop pays); totals always visible (sticky cart bar); quantities huge on print.
6. **One status system across both apps**: `Submitted (editable · countdown)` / `Submitted · locked` / `Processed` / `Cancelled` — consistent chips and colors on mobile and desktop. The countdown is a *grace timer*, not an anxiety timer: helpful, not alarming, with a gentle urgency shift under ~10 minutes.
7. **Visible sync truth**: saved-locally / submitting / submitted / retry states must be unmistakable — a salesman in a dead zone must *know* his order is safe (or not yet sent).
8. **Light theme first** (sunlight readability, high contrast). Dark optional.
9. **Brand-neutral palette + one confident accent**: the app must not look Zebronics-branded — more brands arrive in Phase 3. (Zebronics's identity is red/black; avoid reading as either.)

## 4. The status system

One order lifecycle, one chip vocabulary, everywhere (salesman home, order detail, dashboard table, dashboard detail):

| Chip | Meaning | Notes |
|---|---|---|
| `Submitted · editable 1h 12m` | Submitted; the salesman can still edit or cancel. Live countdown to the end of the 2-hour edit window. | Calm/neutral-positive styling. Countdown rules below. |
| `Submitted · locked` | Submitted, no longer salesman-editable. | **Locked is a derived condition, not a separate stored status.** It happens two ways: the 2-hour window expired, **or** the accountant processed it (processing beats the timer). The chip must read clearly in either case. |
| `Processed` | The accountant locked it and is booking it into Tally. | Terminal-positive. Salesman goes read-only the instant this happens. |
| `Cancelled` | Cancelled by the salesman (while editable) or by the accountant (any time, with a reason). | Terminal-negative. |

**Countdown presentation (decided — see §11):** text inside the status chip, **minute granularity, never seconds** (seconds tick = anxiety). ≥10 minutes remaining: calm neutral chip, e.g. `editable 1h 12m`. Under ~10 minutes: the chip shifts to a gentle amber and reads e.g. `editable 8m` — noticeable, not alarming. **Never red, no progress rings, no pulsing.** At zero the chip simply becomes `Submitted · locked`. Red is reserved for errors and `Cancelled`.

There is **no "Draft" status chip**: unsubmitted carts live only on the salesman's phone (the accountant never sees them). The phone-local draft state is expressed by the offline/sync language in §6, not by the status system.

## 5. Formatting rules (apply everywhere)

- **Currency**: `₹` with **en-IN digit grouping** — `₹60`, `₹9,138`, `₹1,02,584`. Whole rupees, no paise shown in Phase 1 (all catalog prices are whole rupees).
- **Prices are GST-inclusive billing rates.** What you see is what the shop pays. **Never show tax math** — no GST %, no base+tax breakdown, no "incl. taxes" asterisks. The price is the price.
- **Times**: IST everywhere. Same-day: `11:42` (24h). Recent: `Yesterday 16:03`. Older: `06 Jul 2026, 11:42`. "Today" means the IST calendar day.
- **Order refs**: `ORD-2026-1042` format. Sequential-ish but **not gapless** — gaps are normal and by design; never design UI that implies a continuous count.
- **Product names**: verbatim from the catalog — long, ALL-CAPS-ish, occasionally typo'd (see §7). Two-line clamp with ellipsis where clamped.
- **Language**: English UI. Short, plain words ("Saved on phone — not sent yet", not "Persisted locally").

## 6. Global states to design deliberately

These recur across screens; design them once as patterns, then show them on the screens that list them:

- **Loading skeletons** — list/table shimmer, not spinners, for anything network-fetched.
- **Empty states** — first-run home ("No orders yet — tap New Order"), empty search results, empty dashboard day.
- **Error / retry** — failed loads and failed submits always offer a retry; never a dead end.
- **Offline-pending** — the salesman's cart autosaves to the phone on every tap; a submit attempted offline stays on the phone with an unmistakable **"Saved on phone — not submitted yet"** state plus a retry affordance. The distinction between *saved-locally*, *submitting…*, *submitted ✓*, and *retry needed* must be impossible to misread. No silent loss, no silent duplication — ever.
- **Locked / read-only** — a locked or processed order renders read-only for the salesman with the line: "Call the accountant to change this order."
- **Realtime row arrival** — new orders appear on the already-open dashboard within ~5 seconds, with a brief highlight on the new row. Subtle; the accountant sees this dozens of times a day.
- **Countdown urgency shift** — the <10-minute amber state (§4).
- **Print preview** — the pick slip as it leaves the printer (§9).

## 7. Real-data pack (use this verbatim in every mockup)

All product names, prices, and categories below are **real data — use them verbatim**. The names are ALL-CAPS-ish, inconsistently spaced, and occasionally **genuinely typo'd** ("Balck", "Bannk", "Lighting"). **Do not fix, prettify, re-case, or normalize them** — the typos may mirror the accountant's Tally records, and the design must prove it survives real data, not lorem ipsum.

**Six categories, in this fixed display order** (this is also the quick-order grouping order):
Adaptors · Adaptors with Cable · Charging Cables · Earphones · Power Banks · Speakers

**The salesman's catalog = exactly these 34 priced products.** (8 more SKUs exist but are unpriced and therefore invisible to salesmen — there is **no "price TBD" UI state to design**, anywhere.) SKUs are shown because search matches on them; note SKU numbering has gaps (hidden unpriced products keep their numbers) — never renumber.

**Adaptors (4)**
| SKU | Product | Price |
|---|---|---|
| ZEB-ADP-01 | ADAPTOR 33W MULTIPROTOCOL (MA203 PRO) A279 | ₹523 |
| ZEB-ADP-02 | ADAPTOR 35W DUAL PD PORT (MA101B WHITE) | ₹718 |
| ZEB-ADP-03 | ADAPTOR (MA104B WHITE) ZEB | ₹364 |
| ZEB-ADP-04 | ADAPTOR (MA108B WHITE) | ₹380 |

**Adaptors with Cable (6)**
| SKU | Product | Price |
|---|---|---|
| ZEB-AWC-01 | ADAPTOR WITH MICRO USB CABLE (MA200 WHITE) | ₹179 |
| ZEB-AWC-02 | ADAPTOR WITH TYPE C CABLE (MA100B WHITE) | ₹330 |
| ZEB-AWC-03 | ADAPTOR WITH TYPE C CABLE (MA200 WHITE) | ₹195 |
| ZEB-AWC-04 | ADAPTOR WITH TYPE C USB CABLE ( MA110B) | ₹178 |
| ZEB-AWC-05 | CAR CHARGER WITH TYPE C CABLE CC242A3 (BLACK) | ₹186 |
| ZEB-AWC-06 | CAR CHARGER WITH TYPE C CABLE CC38(BLACK) | ₹397 |

**Charging Cables (6)**
| SKU | Product | Price |
|---|---|---|
| ZEB-CBL-01 | Cable Type C to Lighting LT200 (White)Zeb | ₹253 |
| ZEB-CBL-02 | Micro Usb Cable MU240 - ZB CABLE (White) | ₹60 |
| ZEB-CBL-03 | TYPE C TO TYPE C CABLE TT27 PLUS (BLACK) | ₹101 |
| ZEB-CBL-04 | TYPE C TO TYPE C CABLE -TT65 (RED) | ₹135 |
| ZEB-CBL-05 | USB TO TYPE C CABLE TU240P PLUS (WHITE) | ₹72 |
| ZEB-CBL-06 | USB TO TYPE C CABLE ZEB-UT65 (RED) | ₹166 |

**Earphones (5)**
| SKU | Product | Price |
|---|---|---|
| ZEB-EAR-01 | EARBUDS PODS 416 BTH (CHIME R BLACK) | ₹825 |
| ZEB-EAR-02 | Eare Buds BTH (PODS ZI 12 WHITE) | ₹800 |
| ZEB-EAR-03 | Headphone WHP 11 BTH (PARADISE NEO R BLACK) | ₹825 |
| ZEB-EAR-04 | Headphone WHP 8 BTH (PARADISE PLUS BLACK) | ₹887 |
| ZEB-EAR-07 | STEREO EARPHONE WITH MIC (ARIA BLUE) | ₹219 |

**Power Banks (3)**
| SKU | Product | Price |
|---|---|---|
| ZEB-PWR-01 | Power Bank A267-ZEB MW70 10000MAH (BLACK) | ₹1,350 |
| ZEB-PWR-03 | Power Bank OD PB17 10000 MAH (Black) | ₹557 |
| ZEB-PWR-04 | Power Bank ZEB-MB 10000S10 PRO(Balck) | ₹634 |

**Speakers (10)**
| SKU | Product | Price |
|---|---|---|
| ZEB-SPK-01 | Bar Speaker JUKEBAR 2500 WITH 2 MIC (SBSPK1) | ₹3,951 |
| ZEB-SPK-02 | SPK-KSPK 7 PORTABLE BTH SPEAKER (BUDDY 150) | ₹3,129 |
| ZEB-SPK-03 | SPK - PORTABLE BTH SPEAKER (SONO PLUS) | ₹4,550 |
| ZEB-SPK-04 | SPK-PSPK 44 PORTABLE BTH SPEAKER (ASTRA 40 BLACK) | ₹1,029 |
| ZEB-SPK-05 | SPK-PSPK 48 PORTABLE BTH SPEAKER (COUNTY PLUS BLACK) | ₹752 |
| ZEB-SPK-06 | SPK- PSPK 50 PORTABLE BTH SPEAKER (COUNTY 8 BLACK) | ₹566 |
| ZEB-SPK-07 | SPK- PSPK 52 PORTABLE BTH SPEAKER (ZEST 11) | ₹658 |
| ZEB-SPK-08 | SPK-PSPK 8 PORTABLE BTH SPEAKER (BUDDY 100) | ₹1,477 |
| ZEB-SPK-09 | SPK-THUMP 802 BTH PORTABLE SPEAKER (DSPK 102) | ₹9,138 |
| ZEB-SPK-11 | SPK-ZEB COMPUTER MULTIMEDIA 2.1 SOUNDBAR SPEAKER (ABABA 1) | ₹7,250 |

**Stress cases every layout must survive:**
- **Longest name**: `SPK-ZEB COMPUTER MULTIMEDIA 2.1 SOUNDBAR SPEAKER (ABABA 1)` — ₹7,250. Mobile rows clamp at 2 lines; show this row clamped in the quick-order mockup.
- **Price extremes in one list**: `Micro Usb Cable MU240 - ZB CABLE (White)` at **₹60** next to `SPK-THUMP 802 BTH PORTABLE SPEAKER (DSPK 102)` at **₹9,138** — price column/slot must align across 2–4 digit prices.
- **Real typos**: `Power Bank ZEB-MB 10000S10 PRO(Balck)` ("Balck", and no space before the paren), `Eare Buds BTH (PODS ZI 12 WHITE)`, `Cable Type C to Lighting LT200 (White)Zeb`. Render as-is.
- **Near-identical pairs** the search must help disambiguate: `TT27 PLUS (BLACK)` ₹101 vs `-TT65 (RED)` ₹135; the two `ADAPTOR WITH TYPE C CABLE` rows at ₹330 vs ₹195.

**Sample people, shops, and orders for mockups** (fictional, realistic; use consistently):
- Salesmen: **Raju**, **Sunil**.
- Retailers: `Sharma Electronics — Sadar Bazaar — 98765 43210`; `Mobile Point — Station Road — 98123 45678`; `Krishna Telecom — Gandhi Chowk — 99887 76655`; `New Bharat Electronics — Main Market — 90909 80808` (use this one as the "NEW — pending verification" quick-add).
- Worked example order (math is real — reuse everywhere): **ORD-2026-1042**, Sharma Electronics, submitted 06 Jul 2026 11:42 IST by Raju, editable until 13:42, notes "deliver Tuesday morning":
  - 10 × Micro Usb Cable MU240 - ZB CABLE (White) @ ₹60 = ₹600
  - 5 × ADAPTOR (MA104B WHITE) ZEB @ ₹364 = ₹1,820
  - 2 × SPK-PSPK 44 PORTABLE BTH SPEAKER (ASTRA 40 BLACK) @ ₹1,029 = ₹2,058
  - **Total ₹4,478 · 3 items** (item count = distinct lines, not summed quantities)
- Other refs for lists: ORD-2026-1038 (Processed), ORD-2026-1039 (Submitted · locked), ORD-2026-1041 (Cancelled), ORD-2026-1043 (Submitted · editable).

## 8. The 11 screens

### Salesman — mobile web, 360×800 baseline

The flow: `Login → Home (My Orders) → New Order → Pick Retailer → Quick Order List → Review → Submit → Confirmation → back to Home`. Edit (while editable) reopens the same Quick Order list pre-filled.

**S1 · Login**
- Purpose: get in once, then ~never again (session persists ~30 days).
- Contents: email + password, "remember me" **default on**, sign-in button. Nothing else: **no signup, no social buttons, no forgot-password link** (an admin resets passwords out-of-band).
- States: error — wrong credentials; error — deactivated account. Loading on submit.

**S2 · Home — My Orders**
- Purpose: launch pad + order history.
- Contents: **"New Order" is the primary action — big, thumb-reachable (bottom zone)**. Below/around it, the salesman's own orders, newest first, as cards/rows: `order_ref`, retailer name, line count, total, status chip, and — while editable — the live countdown. A **"Today"** section separated from earlier orders (IST days). Tap a card → Order detail (S7).
- States: empty (fresh account — friendly nudge to New Order); loading skeleton; an offline-pending order pinned prominently with "Saved on phone — not submitted yet" + retry.

**S3 · Pick Retailer**
- Purpose: choose the shop in seconds.
- Contents: search-as-you-type over shop name + area; **recent retailers first** (this salesman's latest orders); each row = name + area. **Quick-add** path: name (required), area, phone → creates the retailer flagged **"NEW — pending verification"** and proceeds straight into the order (the accountant cleans it up later — S11). If a local draft exists for a retailer, a **resume prompt** surfaces here: "Continue order for Sharma Electronics? · 3 items · ₹4,478" with Continue / Start fresh.
- States: searching; no-results (leads into quick-add with the typed name pre-filled); quick-add form; resume-draft prompt.

**S4 · Quick Order List — THE HERO SCREEN (spend the most effort here)**
- Purpose: the notebook killer. The shopkeeper dictates; Raju punches quantities one-handed. A 6-line order in well under 90 seconds.
- Contents:
  - **One dense scrolling list of all 34 products** grouped by the six categories in §7 order, category headers sticky-ish. **No pagination, no per-product pages, no images.**
  - **Row = product name (2-line clamp) + price + stepper `[−] qty [+]`.** The `+` is the most-tapped control in the entire product — ≥48px. **Tapping the qty number opens a numeric keypad** for direct entry (typing 24 beats tapping + 24 times). Rows with qty > 0 are **visibly "in cart"** (distinct at a glance while scrolling).
  - **Sticky search bar (top)**: instant, client-side, matches name or SKU, case/space-insensitive substring ("astra" → the ASTRA 40 row). Clearing restores the grouped list.
  - **Sticky cart bar (bottom)**: `3 items · ₹4,478 — Review ▸`. Appears once qty > 0, always visible thereafter. Item count = distinct lines.
- States: default grouped list; searching/filtered; **empty search results** ("no products match 'xyz'" + clear); rows in-cart; keypad open; and the row with the longest name (§7) clamped to 2 lines.

**S5 · Review**
- Purpose: confirm before submit; last chance to adjust.
- Contents: retailer confirmation header (name + area); editable line list — each line: name, qty stepper, unit price, line total, remove; **notes** field (free text, up to 500 chars — "deliver Tuesday", "urgent"); computed total; **Submit** button (primary, bottom).
- States: default; submitting; **submit failed / offline** → "Saved on phone — not submitted yet" + Retry (the order is never lost, and retrying can never create a duplicate — say so calmly in the UI copy).

**S6 · Confirmation**
- Purpose: proof it's in, and the edit-window promise.
- Contents: success mark, **big order ref** (`ORD-2026-1042`), retailer name, total, and **"editable until 13:42"**. Primary action: back to Home. Secondary: view order.
- States: just the one — this screen only appears on confirmed server success.

**S7 · Order detail (salesman)**
- Purpose: history, disputes, and the edit/cancel entry point.
- Contents: status chip + countdown; retailer; line items (**snapshot** names/prices — exactly what was ordered, even if catalog prices changed since); notes; total; **event history in plain words** ("Submitted 11:42", "Edited 12:05 — TYPE C TO TYPE C CABLE TT27 PLUS (BLACK) qty 5→10"). While editable: **Edit** (reopens Quick Order pre-filled) and **Cancel** (confirm dialog). 
- States: editable (buttons + countdown); **locked/read-only** — buttons gone, chip reads `Submitted · locked`, line "Call the accountant to change this order."; processed; cancelled.

### Accountant — desktop web, ≥1280px

**S8 · Orders list (dashboard home)**
- Purpose: the live command center — see orders the moment they land.
- Contents: dense table, newest first: `order_ref` · submitted time (IST — `11:42` / `Yesterday 16:03`) · salesman · retailer (+ **NEW** badge if unverified) · line count · total · status chip · editable-countdown (when running). **Filters**: status, salesman, date (Today / Yesterday / range). **Search** by ref or retailer (`/` focuses it; Enter opens the selected row). Row click → S9.
- States: **live row arrival** (new order slides/highlights in within ~5s, no refresh); loading skeleton; empty day; filtered-empty.

**S9 · Order detail (accountant)**
- Purpose: verify, correct, lock, print.
- Contents: header — ref, status chip, retailer (with phone), salesman, submitted/processed timestamps, countdown if editable. Lines table: name (snapshot), qty, unit price, line total; order total. **Notes prominent** — they carry delivery instructions. **Event timeline**, humanized: "Submitted 11:42 by Raju", "Edited after lock 14:20 by Accountant — TT27 qty 5→10, reason: shop called". Actions:
  - **Mark processed** — the lock; one click + confirm. Means "I am booking this into Tally now"; the salesman goes read-only instantly.
  - **Edit order** — opens a line editor; **after the edit window it requires a reason** (modal) and is logged as an after-lock edit with before/after.
  - **Cancel** — reason required, confirm dialog.
  - **Print pick slip** → S10.
- States: submitted-editable; locked; processed; cancelled; edit-with-reason modal; cancel-confirm.

**S10 · Pick slip (print)** — full spec in §9.

**S11 · Retailer verification queue** (`/dashboard/retailers`)
- Purpose: turn salesman quick-adds into canonical records (their cleaned spellings become the Tally ledger mapping in Phase 2).
- Contents: design as a **variant of the S8 table pattern** — retailer list with verified/unverified filter; **NEW** badges; inline edit of name / area / phone; **Mark verified** action; **Deactivate** (never delete) for dead shops.
- States: queue with pending items; inline-edit row; empty queue ("all verified").

## 9. Pick-slip print spec (A4)

A print-CSS view, **one order per A4 portrait page**. Audience: godown staff picking stock — they read **quantities**, at arm's length, in a warehouse. Reference layout:

```
GANPATI ENTERPRISES — PICK SLIP
ORD-2026-1042                    Submitted: 06 Jul 2026, 11:42
Retailer: Sharma Electronics, Sadar Bazaar    Ph: 98765 43210
Salesman: Raju

  QTY   ITEM
  ───   ─────────────────────────────────────────────────────
   10   Micro Usb Cable MU240 - ZB CABLE (White)
    5   ADAPTOR (MA104B WHITE) ZEB
    2   SPK-PSPK 44 PORTABLE BTH SPEAKER (ASTRA 40 BLACK)

Notes: deliver Tuesday morning

Packed by: ______________    Checked by: ______________
```

Rules:
- **Qty column first and huge — ≥16pt**, right-aligned; body text ≥12pt. The layout must stay sensible from 1 to 20 lines.
- Item names verbatim, full width, wrapping allowed (never truncate on paper).
- Notes block prominent (delivery instructions live there); omit cleanly when empty.
- **Prices are OFF by default.** A toggle (on-screen, before printing) adds unit prices + line totals + order total — that variant is an *order copy* for the retailer. Design both variants.
- Signature lines: `Packed by` and `Checked by`.
- Monochrome-safe: no color dependence, no ink-heavy fills. Show it as a print preview state.

## 10. Deliverables demanded of you

1. **High-fidelity designs for all 11 screens** (S1–S11), including every state listed per screen in §8 and the global states in §6 where they apply. Mobile screens at 360×800; dashboard at 1280+; pick slip as A4.
2. **Component & token sheet**, enough for a builder to implement without guessing:
   - type scale, spacing scale, color palette (including the accent below and status colors),
   - status chips (all four + countdown variants), stepper (default / in-cart / keypad-entry), mobile list rows, dashboard table rows, buttons (primary/secondary/destructive), form fields (incl. error states), badges (NEW), search bars, sticky cart bar, toasts/inline alerts for sync states.
3. **Pick-slip print layout** per §9, both variants (with and without prices).

## 11. Resolved design decisions (final — do not reopen)

1. **Accent color: deep blue (≈ #1D4ED8 family; tune the exact value for WCAG AA on white).** Rationale: brand-neutral (reads as neither Zebronics red/black nor any future brand), strong contrast for sunlight, and it keeps red free for errors/Cancelled and amber free for the countdown-urgency shift.
2. **Countdown presentation: text-in-chip, minutes only.** `Submitted · editable 1h 12m`, neutral until ~10 minutes remain, then amber `editable 8m`; no seconds, no rings, no red, no animation. Rationale: it's a grace timer — reassurance that there's time, not pressure that it's running out.
3. **Pick slip: A4 portrait, laser/inkjet, via browser print.** No thermal/A5 layout in Phase 1. Rationale: the office already prints A4 invoices for the godown today; A4 gives the ≥16pt quantities room. (A thermal variant can be added later without redesign.)
4. **Add-to-home-screen icon: a "GE" monogram, white on the accent blue, rounded-square, flat.** Rationale: text-first product, no imagery exists, legible at 48px, brand-neutral; deliverable sizes 192px and 512px plus a maskable variant.

## 12. Hard constraints — verbatim, do not reinterpret

- **No product images exist. Ever.** Typography carries the catalog.
- **Unpriced products are invisible to salesmen** — there is no "price TBD" UI state to design.
- **No** signup, **no** password-reset self-service, **no** retailer-facing screens, **no** catalog-admin screens, **no** dark-mode-first, **no** marketing pages, **no** onboarding tours.
- The quick-order list shows **~34 products in one scrolling grouped list** — no pagination, no per-product detail pages.
- Product names render **verbatim** — typos and all (§7).
- Prices are GST-inclusive; **never show tax math**.
- **Every screen passes the notebook test: faster than writing it on paper.**
