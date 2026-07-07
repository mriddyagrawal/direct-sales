# BUILDER FIX — bottom tab bar hidden until you scroll

**Branch:** `feature/salesman-app`. Small CSS/layout fix; one atomic commit; reviewer verifies.

**Bug.** On S2 Home (any screen with `<BottomTabBar>`), the 70px bottom bar isn't visible on load — it only shows after scrolling to the bottom of a list that overflows the viewport.

**Why.** The bar is `position: sticky; bottom: 0` and the last child of a `min-height: 100vh` page. But `html, body { overflow-x: hidden }` in [globals.css](../src/app/globals.css) forces the computed `overflow-y` to `auto`, making `body` a scroll container — which **breaks `position: sticky` on descendants**. The bar stops pinning to the viewport and just sits at the bottom of the tall content.

**Fix — app-shell layout (bar = always-visible chrome; only the list scrolls):**
- Page container ([page.module.css](../src/app/page.module.css) `.page`, and any other screen using `BottomTabBar`): use `height: 100dvh` instead of `min-height: 100vh` (dynamic vh also fixes the mobile URL-bar gap); keep `display:flex; flex-direction:column`.
- Scrolling middle region (the orders list container): `flex:1; overflow-y:auto; min-height:0`. **The `min-height:0` is required** — a flex child won't shrink to allow internal scroll without it.
- [BottomTabBar.module.css](../src/components/BottomTabBar.module.css) `.bar`: drop `position: sticky; bottom: 0` — it's now a normal flex child at the bottom, always visible.
- Remove `overflow-x: hidden` from `html, body` in globals.css (it's the sticky-breaker; unneeded once nothing overflows horizontally). If one element overflows sideways, clip that element instead.
- Optional: `padding-bottom: env(safe-area-inset-bottom)` on `.bar` for iOS home-indicator clearance.

**Verify.** With many orders, on a narrow/mobile viewport: the bar is visible immediately at the bottom (no scroll needed), the list scrolls under it, and no horizontal scrollbar appears.
