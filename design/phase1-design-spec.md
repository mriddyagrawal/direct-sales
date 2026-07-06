# Phase 1 Design Spec — extracted from the approved Claude Design deliverable

Source of truth: [design/phase1/Ganpati Phase 1.dc.html](phase1/Ganpati%20Phase%201.dc.html) (imported 2026-07-06 from the owner's Claude Design project; static renders in [design/phase1/renders/](phase1/renders/)). The design went through a deliberate **direction shift** mid-project: from a soft SaaS-card v1 to the final **"instrument"** grammar (turns T2–T4 in the file). Where v1 sections (S1–S8 in the older styling) conflict with the instrument turns, **the instrument grammar wins**; the v1 sections remain authoritative for *state coverage* ("every earlier state carries over unchanged into this styling" — T4).

## 1. Design language — "an instrument, not a dashboard"

A ledger, not a consumer app. The rules, verbatim from the design:

- **Hairline rules replace shadowed rounded cards.** No drop shadows anywhere. Corners: **2px radius** everywhere.
- **Two typefaces**: **Space Grotesk** for structure, labels, names; **JetBrains Mono** for *every figure* — refs, SKUs, prices, quantities, times, countdowns — so numbers are tabular and column-aligned by construction.
- **Accent deployed like a tool**, never decoration: selection, focus, and *one key filled-accent action per view*. No gradients. Faint functional zebra striping only.
- **Status is a flat rectangular tag with a leading status square**, not a pastel pill.
- **Print is ink**: the Print button is the only black-filled control (a hardware verb).

## 2. Tokens

### Color (from the Foundations pass, F)

| Token | Hex | Use |
|---|---|---|
| Accent / editable | `#1D4ED8` | Primary action fill, focus (1px sharp), selection, editable status square, in-cart accent bar |
| Pending / amber | `#B45309` | <10m countdown, offline-pending, NEW retailer tag, Sync-pending square, Retry button. **Amber = pending, never red** |
| Locked | `#6B7580` | `Submitted · locked` square + secondary/inactive text family |
| Processed | `#15803D` | Processed square, ORDER SUBMITTED confirmation |
| Error / cancel | `#B91C1C` | Errors + `Cancelled` **only** — red is reserved |
| Ink | `#14181F` | Primary text, table header underrules, Print button fill |
| Paper | `#F2F3F5` | App ground; cards/sheets are `#FFFFFF` on it |
| Inactive | `#8A94A0` | Inactive tab icons/labels |
| Row-arrival flash | `#DBEAFE → #EFF6FF → #FFF` | Realtime highlight keyframes |

Light theme only (sunlight readability); dark optional and unbuilt in Phase 1.

### Type scale (Foundations pass)

| Role | Spec | Example |
|---|---|---|
| Name / page title | 21px · 700 · Space Grotesk | "Sharma Electronics" |
| Header | 15px · 600 · Space Grotesk | "Review order" |
| Body | 13px · 500 · Space Grotesk | product names |
| Figures | JetBrains Mono, tabular, right-aligned on a shared edge | `₹4,478 · ORD-2026-1042` |
| Section label | 10px · JetBrains Mono · uppercase · +0.08em | `TODAY · 06 JUL` |

### Layout & interaction constants

- Touch targets **≥48px**. Where visual cells are smaller — quick-order steppers **44×50px**, review-screen steppers **40×42px** — the builder must extend the **hit area** to ≥48px with invisible padding; visuals unchanged (BUILDER resolution: spec floor wins, design visuals win). Keypad keys **54px**, max 3 digits, no OS keyboard — the **UI qty cap of 999 is deliberately stricter than the DB's 1..9999 bound**; fail-safe, do not "fix" it in either direction.
- Dashboard: 32px table header with 2px ink underrule; **40px rows** on hairlines with faint zebra; keyboard cursor = **2px accent bar down the row's left edge** (no glowing outline). `/` focuses search, `↑↓` move, `Enter` opens.
- Mobile bottom tab bar — **owner decision 2026-07-06: two destinations only, Home / New Order** (Sync and Profile tabs cut; the bar's slot grammar stays for the future Payments tab — see docs/future-plans.md). **70px**, hairline top, flat; active tab = ink icon + **2px accent top-rule**; **New Order is a solid accent block** (never floats, no shadow); the **amber unsent square sits on the Home tab** while phone-local orders are unsent (Home's pinned "Saved on phone" strip is the sync surface — there is no separate Sync screen). Sign out lives at the bottom of Home ("Signed in as Raju · Sign out"). The bar hides during the order-taking flow (back arrow + sticky Review bar instead).
- Fields: white, 1px hairline border, 2px radius; focus = 1px accent, sharp; error = 1px red + plain-words helper below ("Enter the shop name").

### Status system (one vocabulary, both apps)

Flat tag, leading 8px status square, mono text:

- `■ Submitted · editable 1h 12m` — accent square. Countdown in minutes, never seconds.
- `■ Submitted · editable 8m` — amber square + amber text under ~10 minutes.
- `■ Submitted · locked` — grey. Shown **only** while status is `submitted` past its window; a processed order always shows the green `Processed` chip. **Chip = status** — the derived lock governs edit *permissions*, never chip display (BUILDER resolution 2026-07-06; the original extraction's "same chip either way" contradicted S7/S8).
- `■ Processed` — green.
- `■ Cancelled` — red.

Sync-truth chips (same square grammar): `Saved on phone` (grey) / `Submitting…` (accent) / `Submitted ✓` (green) / `Retry needed` (amber).

### Buttons

Primary = filled accent. Secondary = hairline outline, ink text. Destructive = hairline outline, red text (filled red only inside the confirm dialog). Print = filled ink with printer glyph. One filled-accent element per view, maximum.

## 3. Screens (final instrument styling)

**S1 · Login.** GE monogram block (accent), "Ganpati Enterprises / ORDER CAPTURE · FIELD SALES", mono field labels (EMAIL / PASSWORD + SHOW), "Keep me signed in — ~30 DAYS ON THIS PHONE" checked by default, full-width accent Sign in. Footer: *"Forgot password? Call the office to reset it."* Errors (wrong credentials, deactivated account) render as flat red-edged strips; submit shows an inline spinner in the accent block.

**S2 · Home / My Orders.** Bottom tab bar (above). Offline order pinned above everything: amber-left-bar strip "Saved on phone — not submitted yet" + shop · items · total + mono microcopy `PENDING · WILL RETRY WHEN ONLINE · NO DUPLICATE` + "Sync now" link (v1 also specs a filled amber "Retry now" variant + quiet Offline pill in the header). Cards: ref (mono) + total (mono, right) on top, shop + item count below, status tag. `TODAY · 06 JUL` / `EARLIER` mono section labels (IST days). States: default, offline-pinned, empty ("No orders yet — take your first order — tap New Order below"; New Order stays tappable), loading skeleton (never a spinner).

**S3 · Pick Retailer.** "Select retailer / NEW ORDER · STEP 1 / 3". Search "Shop name or area". `RECENT` group first, then `ALL SHOPS`; NEW tag (amber square family) on unverified shops. Bottom: outlined "+ Add new shop". Quick-add: SHOP NAME (only required field, red asterisk), AREA + PHONE side by side, accent-edged note *"Saved as NEW — pending verification. Order now; the office cleans up the record later."*, full-width "Add & start order"; typed no-results query carries into the name field. Resume-draft: flat bottom sheet, 2px ink top-edge (no rounded modal, no shadow): "Continue order for Sharma Electronics? · 3 items · ₹4,478 · saved 11:31 on this phone" → Continue order / Start fresh.

**S4 · Quick Order (hero).** Header: shop name + `SADAR BAZAAR · NEW ORDER`, back arrow. Sticky search ("Search name or SKU", instant, client-side, name+SKU, case/space-insensitive; result meta "1 of 34 products"; group header stays for context). Category bars = ruled mono labels with counts (`SPEAKERS · 10`). Row = name (2-line clamp) + mono price + stepper `[−] qty [+]`; **+ is filled accent once in cart**; in-cart row = pale accent tint + 2px accent bar down the left edge + bold quantity. Tap qty → own keypad sheet (product name + current qty shown; Cancel / Set quantity; scrim-tap discards). Sticky cart bar splits: **black data half** (`3 items` over mono `₹4,478`) + **accent action half** (`Review ›`) — no floating pill. Cart bar survives filtering and never disappears mid-dictation. Item count = distinct lines. States: default grouped, in-cart + longest-name clamp (…SOUNDBAR SPEAKER (ABABA 1) at 2 lines), searching "astra", empty search ("No products match 'xyz' / Check the spelling, or try part of the SKU" + Clear search — never a dead end), keypad open.

**S5 · Review.** "Review order / STEP 3 / 3". Retailer confirmation header + "Change". Lines: name + mono amount; compact stepper + `@ ₹364` mono rate. `NOTES FOR THE OFFICE` with live `23/500` counter. `Total · 3 items` + mono total. Full-width accent "Submit order". Submit-failed/offline: CTA swaps to **amber Retry** over a flat amber-edged "Saved on phone — not submitted yet" strip; copy says retrying is idempotent ("Retrying never creates a duplicate").

**S6 · Confirmation.** Only renders on confirmed server success. Green check block, `ORDER SUBMITTED` (mono, green), huge mono ref `ORD-2026-1042`, shop · total, tag `■ Editable until 13:42`, accent "Back to Home", "View order" link.

**S7 · Order detail (salesman).** Mono ref header + "SUBMITTED TODAY 11:42". Status tag. Retailer card (name, area, mono phone). Snapshot lines (`10 × ₹60` mono under name) — catalog price changes never rewrite history. Total. Accent-edged NOTES. `HISTORY` in plain words, mono timestamps ("12:05 Edited — MU240 qty 8→10", "11:42 Submitted by you"). While editable: outlined red "Cancel order" + accent "Edit order" (reopens S4 pre-filled). Cancel = confirm dialog ("Cancel this order? … This can't be undone." Keep order / filled-red Cancel order); no reason needed from the salesman. States: editable / locked (*"The edit window has ended. Call the accountant to change this order."* — buttons **gone**, not disabled) / processed (green note: *"Booked into Tally by the office. For any change, call the accountant."*) / cancelled (red strip "Cancelled today 11:05 — by you.").

**S8 · Orders list (desktop).** Top chrome: GE block + GANPATI ENTERPRISES, Orders/Retailers tabs (active = accent + 2px underrule), date+time IST right. "Orders" + LIVE tag; "7 orders · today". Filter tabs (All/Submitted/Processed/Cancelled) + Salesman + Date dropdowns; search right with `/` hint. Ledger table: REF · SUBMITTED · SALESMAN · RETAILER (+NEW) · LINES · TOTAL · STATUS; countdown ticks inside the chip; ref gaps (…1044 → …1046) are real and by design. New rows flash in within ~5s (rowNew keyframes). Footer hints: `/ search · ↑↓ move · ↵ open`. States: live default, loading skeleton, (empty day per v1 pattern).

**S9 · Order detail (accountant workbench).** `← ORDERS` breadcrumb; huge mono ref + status tag; byline "by RAJU · submitted 11:42 · editable until 13:42". Actions right: Print (ink) · Edit (outline) · Cancel (red outline) · **Mark processed** (the one accent action; means "I am booking this into Tally now" — one click + confirm; salesman flips read-only instantly). Left: `ITEM · SNAPSHOT AT SUBMIT` table (QTY / RATE / AMOUNT mono right-aligned), `3 LINES` + TOTAL rule. Right rail: accent-edged `NOTES FROM THE FIELD`, RETAILER card (mono phone), `HISTORY` mono-timestamped register ("Edited after lock 10:55 — TT27 qty 5→10 · reason: shop called"). Post-lock edit and accountant cancel require a reason (logged with before/after).

**S10 · Pick slip (A4 print).** Preview chrome: mono ref + "PICK SLIP PREVIEW", **Prices off / Prices on** toggle, ink Print. Sheet (monochrome, no fills): GANPATI ENTERPRISES + boxed `PICK SLIP` badge; huge mono ref; Submitted/Retailer/Ph/Salesman; **QTY column first, ~30pt mono, right-aligned** — read at arm's length; names verbatim, wrapping, never truncated; `3 LINES` rule; boxed NOTES (empty notes ⇒ box dropped); `Packed by` / `Checked by` signature rules; footer "GANPATI ENTERPRISES · ORDER CAPTURE — Printed 06 Jul 2026, 12:30 · page 1 of 1". **Prices on** adds RATE/AMOUNT/TOTAL and flips the badge to `ORDER COPY` so paper can't be misfiled. GST-inclusive rates, no tax lines.

**S11 · Retailer verification queue.** Same ledger pattern as S8. Filter counts: `All · 5 / ■ Pending · 1 / Verified · 3 / Deactivated · 1`. Pending row opens **straight into inline edit** (name/area/phone fields in-row) with helper *"Fix the spelling now — this exact name becomes the Tally ledger mapping in Phase 2."*; actions Discard / accent **Save & verify** (fixing the spelling *is* the verification act — one motion). Verified rows: Edit / Deactivate. Deactivated rows dim with `DEACTIVATED` tag + Reactivate — never deleted. Empty queue → flat "All shops verified" card.

## 4. Content & formatting rules carried by the design

₹ en-IN mono figures on a shared right edge (`₹60` … `₹9,138` … `₹1,02,584`); GST-inclusive, no tax math ever; IST times (`11:42`, `Yesterday 16:03`, `06 Jul 2026, 11:42`); refs `ORD-2026-1042` with real gaps; product names verbatim from the catalog including typos ("Balck", "Eare"); worked example order everywhere: ORD-2026-1042 · Sharma Electronics · 10× MU240 ₹600 + 5× MA104B ₹1,820 + 2× ASTRA 40 BLACK ₹2,058 = **₹4,478 · 3 items**.

## 5. Deviations from / additions to the prompt (flagged, all defensible)

1. **Bottom tab bar** — owner-requested addition (T3), **resolved by the owner 2026-07-06: Home + New Order only**. Sync tab cut (Home's pinned unsent strip + the amber square on the Home tab carry sync truth); Profile tab cut (sign-out at the bottom of Home). Slot grammar reserved for the future Payments tab (docs/future-plans.md).
2. **Typefaces**: prompt left type open; design pins Space Grotesk + JetBrains Mono. **Builder mandate:** subset both fonts, `font-display: swap`, and declare system fallback stacks (`system-ui` for structure; `ui-monospace, Menlo, Consolas, monospace` for figures) so first paint never waits on webfonts — the <2s-on-4G budget outranks typography.
3. **Countdown chip** reads `Submitted · editable 1h 12m` — matches the prompt's decision (minutes only, amber <10m, never red).
4. **Pick-slip qty is ~30pt**, beating the spec's ≥16pt minimum. Prices-off default honored; `ORDER COPY` header flip is an addition that prevents misfiled paper.
5. **v1 vs instrument**: implement only the instrument grammar; use v1 sections (sec-s1…s8 renders) solely as state checklists.
6. **Product mark — owner decision 2026-07-06:** the **receipt glyph** ([favicon.png](phase1/favicon.png) — zigzag-edged bill with two ink lines) is the icon *everywhere*: favicon, add-to-home-screen, and the S1 login block. This **overrides** the designer's GE-monogram decision; render it in ink or accent per context. Android maskable icons need a padded safe-zone variant at build time.
