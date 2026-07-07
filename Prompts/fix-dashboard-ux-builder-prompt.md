# BUILDER FIX — dashboard UX: stale-after-save, loading feedback, hidden verify, tally-name default

**Branch:** `feature/accountant-dashboard`. Mostly client-side; small atomic commits; reviewer verifies. Owner found these testing M5 — they make the dashboard feel broken, so fix before prod.

## 1. 🅐 The dashboard doesn't update after a save (root of most of the confusion)

**Bug.** After pricing a product, or verifying/deactivating a retailer, the row keeps showing the **old** value — looks like nothing happened. The write actually succeeded (a full page reload shows it).

**Why.** `ProductsPricing` ([ProductsPricing.tsx:23](src/app/dashboard/products/ProductsPricing.tsx#L23)) and `RetailersQueue` ([RetailersQueue.tsx:23](src/app/dashboard/retailers/RetailersQueue.tsx#L23)) hold the server data in `const [x] = useState(initialX)` **with no setter**. `useState` reads its argument only once, on mount — so the `router.refresh()` these call after a write *does* refetch fresh data, but the component ignores it and re-renders the frozen original list.

**Fix.** Render straight from the prop (drop the frozen `useState`; keep only UI state — `editingId`/`form`/`saving`/`tab`). Then `router.refresh()` actually updates the rows. (`OrdersList` is fine — it has a setter for Realtime. `OrderWorkbench` renders from props; confirm it reflects after Mark-processed/Cancel too.)

## 2. 🅑 No visible "loading" when a button is pressed

**Bug.** Clicking a button gives no clear working-signal; the owner re-clicks, unsure anything happened.

**Why.** Primary buttons pass `loading={saving}` (spinner), but **Deactivate / Reactivate / Edit only get `disabled={saving}`** → a faint 60%-opacity dim, no spinner ([RetailersQueue.tsx:192-200](src/app/dashboard/retailers/RetailersQueue.tsx#L192)). Worse, `saving` flips back to false the instant the DB call returns — *before* `router.refresh()` repaints — so there's a dead gap where nothing looks busy (and with 🅐 the repaint changed nothing anyway).

**Fix.** (a) Put a spinner/busy state on the **actual button clicked** (per-row/per-action, not one shared dim that greys the whole list). (b) Keep it busy **through the refresh**: wrap `router.refresh()` in `useTransition` and drive the button's `loading` off `isPending`, so it stays busy until the new data paints. Apply across Products, Retailers, and the OrderWorkbench actions (Mark processed / Edit / Cancel).

## 3. 🅒 The retailer "approve / verify" action is hidden

**Bug.** On a pending retailer the only visible buttons are **Edit + Deactivate** — no obvious "Approve." Verify currently only happens by clicking the row body (or Edit) → inline editor → "Save & verify" ([RetailersQueue.tsx:169](src/app/dashboard/retailers/RetailersQueue.tsx#L169)), which isn't discoverable.

**Fix.** On pending rows (`active && !verified`), surface an explicit accent **"Review & verify"** button as the primary action — it opens the inline editor pre-filled → Save & verify (per S11: fixing the spelling *is* the verification). Keep Deactivate. No RLS change — both accountant and admin already have verify rights; the salesman can only add unverified.

## 4. 🅓 Tally name: keep optional, default to the product name

**Ask.** `tally_name` should default to the product's own name (the Tally import name ≈ the product name), not force typing.

**Fix.** Keep `tally_name` nullable/optional (blank → `NULL`). Everywhere it's **consumed** — the Products list display now, the Phase-2 Tally export later — **fall back to `products.name` when `tally_name IS NULL`**. Do **not** copy the name into the column on save (leaving it NULL keeps "explicitly mapped" distinguishable from "defaulted" for Phase-2 QA). In the Products editor, show the product name as the field **placeholder** so the accountant sees what the default will be.

## Verify (by execution, as the accountant)

- Set a price → the row updates to that price **with no reload**; "Set price" becomes the price; salesman then sees the SKU (D2).
- Verify a pending retailer via the new **Review & verify** button → it leaves Pending, appears under Verified, no reload.
- Deactivate / Reactivate → the row moves and the clicked button shows a spinner while it works.
- Every dashboard action shows a spinner from click until the list repaints (no dead gap).
- A product with blank `tally_name` shows the product name as its effective Tally name.

## Don't

- Re-introduce frozen `useState(initialX)` for server data anywhere.
- Copy `tally_name` from the name into the column; change RLS; edit the reviewer's blocks; or stack new work on an unfixed 🔴.
