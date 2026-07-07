# BUILDER FIX — Salesman new-order flow: density, in-cart color, category headers, drop step labels

**Branch:** a small feature branch off `main` (owner will create it). Client CSS + small header/text changes; small atomic commits; reviewer verifies. All from real-use owner feedback.

**Rule for the whole prompt:** these tighten *visuals* — **never shrink the actual tap targets.** The qty stepper / keypad hit areas stay **≥48px** via invisible hit-area padding (design spec §2), even where the visible cell gets smaller.

## 1. Reduce row whitespace (Quick Order / S4)
Each product row is too tall — too few products fit per screen for fast dictation. Tighten the vertical rhythm: reduce `.productRow` padding ([QuickOrder.module.css:65](src/app/new-order/QuickOrder.module.css#L65), currently `10px 0`) and trim the category-header padding, so noticeably more rows show at once (denser ledger). Keep the stepper's tap area ≥48px as the visible row shrinks.

## 2. In-cart blue too pale → more saturated (Quick Order / S4)
`.productRowActive` background is `#eff6ff` ([:74](src/app/new-order/QuickOrder.module.css#L74)) — barely visible. Make an in-cart row **unmistakable at a glance**: a clearly-saturated accent tint (start around `#dbeafe`, go stronger if it still reads faint), keeping the 2px accent left-bar and dark, legible text.

## 3. Category headers scannable (Quick Order / S4)
`.categoryHeader` ([:47](src/app/new-order/QuickOrder.module.css#L47)) is 10px muted grey — too faint to anchor scanning. Strengthen it as a divider: **color grey → ink** (`var(--color-locked)` → `var(--color-ink)` — the big win), **size 10 → ~12px** (keep mono / uppercase / letter-spacing + the hairline rule), and **make it sticky** just under the search bar (`position:sticky; top:<search-bar height>; z-index:9`, solid white background) so the current category stays pinned while scrolling a long group. Caveat: the search bar's height varies (the "1 of 34" `resultMeta` line only shows while searching) — pin a consistent offset (fixed search-bar height, or one shared CSS var) and verify the two stickies stack with **no overlap/gap** on a phone. Leave `.productName` unchanged (13px ink).

## 4. Drop the "STEP n/3" labels; simpler flow headers (S3 / S4 / S5)
**No step language anywhere.** Via the shared [`FlowHeader`](src/components/ui/FlowHeader.tsx) (make its `subtitle` optional):
- **S3 Pick Retailer:** title **"Select retailer"**, no subtitle. (Drop "NEW ORDER · STEP 1 / 3".)
- **S4 Quick Order:** title = **retailer name**, subtitle = **area** only, e.g. "Sadar Bazaar" (drop "NEW ORDER", drop the step). The header now does real work — it constantly confirms *who* the order is for, cutting wrong-shop errors.
- **S5 Review:** title **"Review order"**, no subtitle. (Drop "NEW ORDER · STEP 3 / 3".)
Keep the back arrow on every screen (it's the navigation while the tab bar is hidden). Update design-spec §3 (which specs the "STEP n/3" subtitles) in the same commit.

## Verify (phone viewport, real screen)
- More products visible per screen; rows tighter but every tap still lands (≥48px).
- An in-cart row is obviously highlighted (saturated blue + accent bar).
- Category headers read as dark, sticky dividers under the search bar.
- No "STEP" text anywhere; S4 header = shop name + area; S3 = "Select retailer"; S5 = "Review order".

## Don't
- Shrink the real tap targets; reintroduce step counters; drop the back arrow; edit reviewer blocks; stack on an unfixed 🔴.
