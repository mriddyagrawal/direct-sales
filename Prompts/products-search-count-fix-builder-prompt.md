# Builder prompt — Products page: server-side search + true count (beyond the 1000-row cap)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-19** · grounded against the live products page. **FE-only, no DB migration.**

## The bug (verified)
The dashboard Products page loads `products` with **no `.limit()`**, so PostgREST caps it at its **default 1000 rows** ([dashboard/products/page.tsx](../src/app/dashboard/products/page.tsx) — `.select(…).order("category").order("name")`). With ~1,385 products:
- The last ~385 (e.g. **Sargam**) never load, and the search is a **client-side filter over the loaded set** ([ProductsPricing.tsx](../src/app/dashboard/products/ProductsPricing.tsx) — `filteredProducts = products.filter(… q …)`), so they're **unfindable**.
- The header shows **`{products.length} products`** (= 1000, capped) — misleading.

## Goal
Search must find **any** product (incl. beyond the cap), and the count must be **true**, **without rendering the whole catalog** (the browse stays bounded). Two parts:

## Part 1 — true count in the header
In `page.tsx`, add two head-count queries (cheap, no rows fetched):
```ts
supabase.from("products").select("*", { count: "exact", head: true })                 // total
supabase.from("products").select("*", { count: "exact", head: true }).not("price_paise","is",null) // priced
```
Pass `totalCount` + `pricedCount` to `ProductsPricing`; the header renders **those** (`{totalCount} products · {pricedCount} priced`) instead of `products.length`/the client `priced`. Keep the default browse fetch as-is (the first 1000 by category/name) — it's the *browse*, not the source of truth for the count.

## Part 2 — server-side search
In `ProductsPricing`, when the search box has a non-empty query, **query the DB** instead of filtering the loaded set:
- Debounce (~250ms). Use `createClient()` (browser). Fetch the **same columns** as `page.tsx` (so the row/edit UI is unchanged), matching across name / tally_name / category:
  ```ts
  supabase.from("products")
    .select("id, brand_id, category, name, price_paise, active, tally_name, stock_qty, stock_updated_at, brands(name)")
    .or(`name.ilike.%${s}%,tally_name.ilike.%${s}%,category.ilike.%${s}%`)
    .order("category").order("name").limit(200)
  ```
- **Sanitize `s`** before interpolating into `.or()` — strip/escape PostgREST filter metacharacters (`,` `(` `)` `%` and leading/trailing spaces) so a stray comma/paren can't break the filter (this string goes into PostgREST's filter grammar).
- Render the returned matches through the **existing** grouped table/cards. When the query is empty, render `initialProducts` (today's browse). Show a small **"showing first 200 matches — refine to narrow"** note when the result length hits 200, and a loading state while the query is in flight. "No products match" stays for 0 results.
- At ~1,400 rows an ILIKE seq-scan is sub-millisecond; no index needed.

## Acceptance
- Searching **"sargam"** (or any product past the first 1000) finds it and it's editable as normal.
- The header shows the **true** total + priced counts (not 1000).
- With the search box empty, the page looks/behaves exactly as today; the render stays bounded (browse as-is + search ≤ 200).
- Admin/accountant gating unchanged; `tsc`/`eslint`/`build` clean.
- Commit: `fix(products): server-side search + true count (find products beyond the 1000-row fetch cap)`.

## Guardrails
- FE-only — no DB migration; read newest `comments.md` first.
- Keep the search-fetch column list **identical** to `page.tsx` (drift breaks the row UI).
- Sanitize the search string for the PostgREST `.or()` filter.
- Money stays paise (`formatRupees`); commit message literally accurate — the REVIEWER verifies by execution.

## Note (not in scope, for later)
The default *browse* still shows a capped 1000 by category/name — fine for now (everything's findable via search). If browsing the full catalog gets unwieldy as it grows, the real answer is the **brand-scoped + virtualized** catalog pass already queued for the Bajaj perf work — fold this page into that.
