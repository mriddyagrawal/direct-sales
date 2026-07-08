# Builder prompt — Quick Order polish (LG price label · control sizing · model prefix)

Three small refinements to the salesman **Quick Order** (`src/app/new-order/QuickOrder.tsx` + its module CSS), on the just-merged Phase-3b collapse/manual-price rows. Items **1–2 are frontend-only**; item **3 adds a one-line `brands.show_model` migration** + a query field. One or two commits.

## 1. "Tap to price" must match the price text *exactly*
The manual-brand placeholder **"Tap to price"** (`QuickOrder.tsx` ~L182) renders in a different font/weight than the ₹ prices on priced rows (~L183) — both come from `priceLabel`, but the styling diverges. Make the placeholder **identical** to a real price: same **font-family, size, weight, colour, letter-spacing**. If "Tap to price" is carrying a distinct/muted class, unify it with the price class so a priced Luminous row and an unpriced LG row read the same on the price line.

## 2. Expanded stepper + price input — slightly smaller
When a row is expanded, the revealed **`<Stepper>`** (~L221) and the **manual price input** (`.priceField` / `.priceInput`, ~L210–213) are oversized on a phone. Bring **both** down a notch — a more compact stepper and a shorter/narrower price input.
- **Keep the stepper's tap targets ≥48px** (the standing design rule). "Smaller" means trim the excess *above* 48px and tighten the price-input height/padding — **do not** drop below the 48px touch-target minimum.

## 3. Model (tally name) prefix — per-brand `show_model` flag
Show the model to the **left** of the product name, lighter — e.g. **`LG 43UA73806LA`・UHD TV 43"** — gated on an **explicit per-brand flag** (owner wants brand-specific control, *not* tied to pricing mode — because both LG and Luminous have `tally_name ≠ name`, so a tally≠name rule would wrongly light up Luminous).
- **Migration** (standard **14-digit** filename, **no `T`** — per the ㉝ reconciliation): `alter table brands add column show_model boolean not null default false;` then `update brands set show_model = true where code = 'LG';` (Zebronics/Luminous stay `false`). Regenerate `database.types.ts`.
- **Render** `{tally_name}・{name}` when the product's brand has **`show_model = true`** — the **model (`tally_name`) lighter** (muted / `--color-locked`), then a `・` (U+30FB) separator, then the display **name** in normal ink. Brands with `show_model = false` (Luminous, Zebronics) show **just the name**, unchanged.
- **Data:** the Quick Order product query must expose, per product, both **`tally_name`** and the brand's **`show_model`** — add `tally_name` to the product `select` and join the brand's `show_model` (where `new-order` loads products, e.g. `src/app/new-order/page.tsx`); thread both to the row (extend the row type).
- Optional guard: also require `tally_name !== name` so a `show_model` brand with a defaulted tally never renders "X・X".

## Guardrails
Items 1–2 frontend-only (`QuickOrder.tsx` + CSS). Item 3 adds the `brands.show_model` column (default false) + sets LG=true + fetches `show_model` & `tally_name` in the Quick Order product query (regenerate types); the new migration uses the **standard 14-digit filename, no `T`**. No other backend/RPC changes. Don't regress the collapse/reveal, Brand▸Category grouping, brand lock, or manual pricing. **≥48px tap targets preserved.** Reviewer verifies by execution on a **phone** viewport.
