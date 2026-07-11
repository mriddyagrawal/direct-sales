# Orders UI spec — mobile revamp (list + detail), glyph system, salesman nav

Owner-approved design, 2026-07-10 (mockup panels **7a–7f**). One list component
(`OrdersView`) and one detail component (`OrderDetailView`) serve **both roles** —
RLS decides which rows exist, the `role` prop decides which extras render. This
doc is the source of truth for the *look and behaviour*; the *state machine* lives
in [order-lifecycle.md](order-lifecycle.md). Where the two touch, this doc defers
to the lifecycle spec.

> **Dispatch added 2026-07-12 (Stage 2).** New **`dispatched`** chip (teal, distinct from billed's green) + a **Dispatched** tab after Billed on the shared list. On the detail, a billed order gains a **Mark dispatched** primary (`truck` glyph, light confirm, no input) for **godown + staff** (never the salesman); `dispatched` is terminal (Share + admin Cancel; byline gains "· dispatched {time} by {name}"). The **godown** is now a first-class **`role`** on both `OrdersView` and `OrderDetailView` — its **Dispatch**/**History** tabs reuse the list (prices shown; no salesman/brand filters; chip-tabs hidden), its `/godown/orders/[id]` reuses the detail (read-only + Mark dispatched). A fixed **GodownTabBar** (Pickup · Dispatch · History) is the godown's status nav. Audit: every `!isStaff` that meant "salesman" is now an explicit `role === 'salesman'`, so the godown lens never inherits the salesman's guidance banners/actions.

The mockup shipped as images only; this section describes each panel in words so
the spec is self-contained.

---

## 0. Owner decisions folded in (these override the 7f reference card)

The 7f mockup was drawn before these were settled. Where 7f disagrees, **this
section wins**:

1. **Billed is NOT terminal.** An **admin** can still **Cancel** a billed order
   (returns / voids) — the backend already allows `billed → cancelled`. 7f's
   "Billed = Share only" applies to the *salesman*; the admin also gets a Cancel.
   Only **Cancelled** is truly terminal.
2. **Salesman self-cancel stays.** A salesman may **Cancel his own order while it
   is `pending_approval` and in-window** (mirrors the Edit rule). 7f's "Cancel =
   admin-only" is wrong; the role table below is corrected.
3. **Deposits is a live, tappable nav tab now** → routes to a **"Coming soon!"**
   placeholder page. The real feature lands later (~next month) and just replaces
   the placeholder; the nav does not move.

---

## 0.1 Build notes (shipped 2026-07-10, `feature/orders-ui-revamp`) — deviations & choices

- **Card meta line carries no brand** — the ref eyebrow already encodes it
  (`ORD-LG-…`), so the meta stays exactly `salesman · time` (staff) / `time`
  (salesman).
- **Approved chip label:** chose **"Approved · waiting for scan"** (the §4
  long form) everywhere the chip renders; the tab keeps
  "Approved/Waiting for Scan". Only LG ever holds `approved`.
- **The timeline byline stays** (submitted / editable-until / approved /
  picked / billed / cancelled times + actors) as a third hero line — §3
  didn't call it out, but it's the at-a-glance audit line and HISTORY only
  covers it verbosely.
- **Model eyebrow renders only when `tally_name !== product_name`** (a
  defaulted tally would just repeat the name).
- Serial sub-rows are **view-mode only** (they'd tangle the staff inline
  editor); `Copy serials` lives beside the ITEMS section label.
- The FAB is a pill (`+ New Order`), offset above the mobile bottom bars.

---

## 1. Glyph system (applies app-wide)

- Adopt **`lucide-react`** as the single icon set. No CDN — it bundles locally and
  tree-shakes per-import.
- **Icon + label, never icon-only** (7f). Every glyph action carries its text.
- Standard size **18px**, `strokeWidth` **1.75**, `aria-hidden` on the glyph with
  the label providing the accessible name (or an `aria-label` on icon-only-looking
  controls — but we don't have those).
- Suggested mapping (builder may pick the closest lucide name):

  | Use | lucide |
  |---|---|
  | Orders (nav) | `receipt-text` |
  | Deposits (nav) | `wallet` |
  | Retailers (nav) | `store` |
  | Products (nav) | `package` |
  | Users (nav) | `users` |
  | New Order (FAB) | `plus` |
  | Sign out | `log-out` |
  | Approve | `check-circle` |
  | Mark billed | `stamp` |
  | Scan (approved order, all roles) | `scan-barcode` |
  | Edit | `pencil` |
  | Share | `share-2` |
  | Cancel | `x` (red) |
  | Copy serials | `copy` |
  | Back | `chevron-left` |
  | Search | `search` |

---

## 2. Orders list (`OrdersView`) — panels 7a (admin) / 7b (salesman)

**Card, replacing the current one** (this is the scan target — a wholesaler
eyeballing a list):

```
┌─────────────────────────────────────────────┐
│ ORD-LG-1026                 [Pending approval]│   ← ref = mono grey eyebrow · status chip
│ Aakash Electronic & Furniture      ₹58,000    │   ← retailer BOLD (scan target) · amount BOLD right
│ Sitaram · Today 09:12                         │   ← one grey meta line
└─────────────────────────────────────────────┘
```
- **Ref** is a mono grey eyebrow (de-emphasised — nobody scans by ref).
- **Retailer name** and **amount** are the two bold "scan targets".
- **One grey meta line**: `salesman · timestamp` for staff; **`timestamp` only**
  for the salesman (every row is his — drop the name).
- **Pending-approval cards get an amber left-border accent.** No other status gets
  a coloured border — the accent means "needs a human". (Reuse the status tone
  colour for the 4px left edge.)
- **Cancelled** cards render the **amount struck-through**.
- Status chip stays top-right (reuse `StatusTag` / `getOrderStatusTag`).

**Header / title**
- Staff: **`Orders`**. Salesman: **`My orders`**. (Currently hard-coded `Orders`.)
- Top strip is the shared `TopStrip` (brand + name · Sign out) — already present.

**Tabs** (unchanged set, restyle to the chip look): `All · Pending approval ·
Approved/Waiting for Scan · Ready to bill · Billed · Cancelled`, each with a live
count, horizontally scrollable on a phone. Active chip is the filled/outlined one.

**Filters**
- Staff: `SALESMAN` + (when ≥2 brands) `BRAND` dropdowns, date range, search.
- Salesman: **search only** — no salesman/brand filters (dead weight; all rows his).
- The `/` keyboard hint is **desktop-only** — hide the `(/)` affordance on mobile.

**New Order** becomes a **floating FAB** (`+ New Order`, filled accent, bottom-
right), for both roles, replacing the bottom-bar New Order slot. The list needs
bottom padding so the FAB never covers the last card.

---

## 3. Order detail (`OrderDetailView`) — panels 7c / 7d / 7e

Single-column on mobile, in this order: **back-eyebrow → hero → primary action →
secondary actions → ITEMS → NOTES → HISTORY**. (Desktop may keep the existing
two-column split; mobile is the target.)

**Back-eyebrow + status:** `‹ ORD-LG-1018` on the left, status chip on the right.

**Hero:** the **retailer is promoted into the header** — name bold + large, then a
meta line `area · phone · salesman`. (Today the retailer sits in the right rail;
move it up. Phone shows for staff; for the salesman, area is enough — phone
optional.)

**Primary action = the status** (one filled-accent button; see §5 for the table):
- `pending_approval` → **Approve order** (admin only)
- `approved` (waiting for scan) → **no loud primary**; admin gets a quiet
  **Mark billed** override (see §4)
- `ready_to_bill` → **Mark billed**
- `billed` → **Share PDF** as the primary (terminal-ish)
- `cancelled` → **Share PDF** only

**Secondary actions** (glyph + label, in a row under the primary): **Edit · Share ·
Cancel**, with **Cancel red and set at the far end**. Which of these render is the
§5 role/status table — e.g. a billed order shows Share + (admin) Cancel; a
cancelled order shows Share only.

**ITEMS** — the table teaches the brand type by its *shape*:
- Header `ITEM · QTY · RATE · AMOUNT`, plus a **`Copy serials`** link (staff, when
  serials exist).
- **Model brand (LG, `show_model=true`)**: each line shows a **model eyebrow**
  (mono grey, the product's `tally_name`, e.g. `TS-Q19YNZE`) above the display
  name, and the **serials nest directly under that line**, indented:
  `SERIAL 605SRYJ003034` for a qty-1 line, `SERIALS …/…` for a qty-2 line. **No
  repeated product names** — one name, its serials beneath (the redundancy fix).
  When the order is not yet picked (`approved`, or `pending_approval`), the serial
  row reads the italic placeholder **"captured at picking, after approval"** —
  teaching the sequence (models are known at order time; serials come after).
- **Names-only brand (Zebronics, `show_model=false`)**: plain lines, **no model
  eyebrow, no serial sub-rows**, and a single grey footnote under the table:
  **"No model / serial tracking — {Brand} products carry names only."** The table
  shape itself signals the brand type — no badge needed.
- Footer: `{n} units · Total (incl. GST) {₹}`. **Note:** "incl. GST" is a *label*
  only — we store a flat total in paise and compute no tax. Keep the label (prices
  are entered GST-inclusive by convention) but do not imply a tax breakup; a real
  GST split is a Tally-export follow-up, not this work.

**Serials show for both roles** (owner flip, 2026-07-11 — 7e's salesman card was
the intent after all): the salesman sees the serials on **his own** orders via the
`order_item_scans_select_salesman` RLS policy (migration `20260709232132`,
SELECT-only, own orders only — probe-verified he sees exactly his rows and no one
else's). The italic "captured at picking" placeholder and `Copy serials` remain
**staff-only**.

**Salesman status notes** (green info banner, his lens on the status — keep the
existing copy): pending → "Waiting for office approval…"; approved/ready_to_bill →
"Approved & picked — the office will bill it shortly." / "Approved — the office
will bill it shortly."; billed → "Booked into Tally…"; cancelled → "Cancelled …".

**NOTES FROM THE FIELD** — surface prominently on `pending_approval` (they gate the
admin's approve decision, e.g. "Confirm stock of 5-star before approving"). Empty
renders "— no notes —".

**HISTORY** — unchanged (`describeEvent`): Submitted / Approved / Picked / Billed /
Cancelled, actor + relative time.

---

## 4. The `approved` / "Waiting for scan" screen (NEW — was missing from the mockup)

Every **LG** order passes through `approved` after an admin approves it and before
the godown scans it. It has its own tab ("Approved/Waiting for Scan") but no panel
was drawn. Spec:

- **Status chip:** the existing `approved` tone, label **"Approved · waiting for
  scan"** (or the shorter "Approved/Waiting for Scan" the tab uses — keep them
  consistent).
- **Hero / items / notes / history:** identical to any other detail screen. The
  model eyebrow shows; the **serial rows show the "captured at picking, after
  approval" placeholder** (same as `pending_approval` — not yet picked).
- **Primary action:** **none for the normal path** — the order is the godown's move
  now; the admin waits. Instead show a quiet line: **"Waiting for the godown to
  scan serials."**
- **Admin override:** the backend allows `approved → billed` (bill an LG order
  without the godown step). Surface it as a **secondary** (not the loud primary):
  a **Mark billed** glyph+label button, so an admin *can* bill directly when
  needed, but the design nudges toward the scan path.
- **Secondaries otherwise:** Edit (admin) · Share · Cancel (admin), as elsewhere.
- **Scan button (all roles, 2026-07-11):** scanning is no longer godown-only.
  On an `approved` order every role gets a **Scan** button (`scan-barcode`,
  white/`secondary`) → `/scan/[id]`. Staff: the Mark-billed override splits into
  **Mark billed | Scan** (`.splitRow`, equal halves). Salesman: **Share | Scan**
  in the secondaries. `/scan/[id]` and `submit_pick` both gate on `approved`, so
  once picked the order is `ready_to_bill` and the scan screen redirects away.
- Salesman lens on an `approved` order: the green note "Approved by the office —
  waiting to be processed." (existing copy), Share PDF, and now **Scan** his own
  order; read-only otherwise.

---

## 5. Roles × status × actions (the corrected 7f)

**Pipeline** (corrected — the LG scan hop was missing):
```
pending_approval ──approve──▶  (LG)  approved ──godown scan──▶ ready_to_bill ──bill──▶ billed
                  └─approve──▶ (fixed)        ready_to_bill ──bill──▶ billed
   approved ──bill (admin override)──▶ billed
   cancel (admin, reason) allowed from ANY state incl. billed
   cancel (salesman, own, in-window) allowed from pending_approval
```

**Primary action by status:** pending_approval → Approve · approved → *(none;
admin override Mark billed as secondary)* · ready_to_bill → Mark billed · billed →
Share PDF · cancelled → Share PDF.

**Who can do what:**

| Action | Salesman | Admin | Accountant (staff, non-admin) |
|---|---|---|---|
| Approve | — | ✓ (pending only) | — |
| Mark billed | — | ✓ (approved override / ready_to_bill) | ✓ (same) |
| Cancel | ✓ own · pending · in-window | ✓ any state incl. billed | ✓ (reason) |
| Edit | ✓ own · pending · in-window | ✓ | ✓ |
| Share PDF | ✓ | ✓ | ✓ |

(The RPCs + `guard_order_transition` enforce all of this server-side; hiding a
button is cosmetic. "Admin" = `isAdmin`; approval is admin-only, billing/cancel are
any staff.)

---

## 6. Salesman navigation

- Bottom bar becomes **Orders** (`receipt-text`, routes `/`) · **Deposits**
  (`wallet`, routes `/deposits`). Rename the old **Home → Orders**. New Order
  leaves the bar and becomes the FAB (§2).
- **`/deposits`** is a real route rendering a **"Coming soon!"** placeholder
  (centered, same shell). Tappable, not disabled. Replaced by the real feature
  later without touching the nav.
- Admin bottom bar is unchanged in shape (Orders · Retailers · Products · Users),
  now with lucide glyphs + labels.
