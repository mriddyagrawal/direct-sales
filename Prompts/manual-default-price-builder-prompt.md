# Builder prompt — Manual-pricing brands get a per-product DEFAULT price

Manual-pricing brands (LG) keep manual pricing, but each product may now carry an
**optional default price**: imported from the Excel, editable in Products admin,
**pre-filled** into the Quick Order unit-price input, and used as the server-side
**fallback** when the salesman doesn't override it. The salesman can still change
the price per order (above or below — no floor, same trust model as today). Context:
[docs/specs/salesman-app.md](../docs/specs/salesman-app.md),
[docs/phase3-multi-brand-design.md](../docs/phase3-multi-brand-design.md).

## The model (small — mostly wiring what already exists)
`products.price_paise` already exists and is nullable; there's no constraint stopping
a manual-brand product from carrying one (`products_price_paise_check` is just
null-or-positive — verify). Today all 526 LG products are null. This makes that
column the **default** for manual brands:
- **Fixed brands (Zebronics/Luminous):** `price_paise` is authoritative + untamperable
  (unchanged — the RPC snapshots it and ignores any client price).
- **Manual brands (LG):** `price_paise` is a **default** — the client pre-fills it,
  the salesman may override, and the server uses it only as a fallback.

## 1. Import (`src/app/dashboard/products/ImportWizard.tsx`) — verify, likely no change
The wizard already maps the `Price` column → `price_paise` for the selected brand,
brand-agnostically ("Price blank ⇒ TBD"). **Verify by execution** that importing an
**LG (manual)** sheet with a `Price` column populates `price_paise` (the default) and
that nothing nulls manual prices on the way in. If some path special-cases manual
brands to null the price, remove it. (Optional nicety: in the wizard's column hint,
note that for manual brands Price = the default.)

## 2. Products admin (`ProductsPricing.tsx` / `ProductModal.tsx`) — verify editable
A manual product's price is now its editable **default**. Ensure the admin can set/edit
it (the list already shows `price_paise` or TBD; confirm the edit modal persists a price
for manual-brand products). Optional: label it "Default price" for manual brands vs
"Price" for fixed — nice-to-have, not required.

## 3. Quick Order (`src/app/new-order/QuickOrder.tsx`) — the real change
The unit-price input must be **genuinely prefilled** with the product's default, and the
default must flow through the **line total, cart total, and submit payload** — not just
appear visually. Today `priceLabel`/`inputVal` read only
`entered = prices?.[id] ?? snapshotPrices?.[id]`, and totals/payload read `prices[id]`, so
an untouched manual line reads as unpriced (₹0 / "Tap to price") until tapped. Fix both
the display **and** the committed value:
- **Seed the cart price on add (the important bit):** when a manual product **with a
  default** is added to the cart (its qty goes `0 → ≥1`) and no price is entered yet, seed
  `prices[id]` with `p.price_paise` (via the parent's `onChangePrice`). Now the line total,
  the cart total, and the submit payload all carry the default automatically — exactly as
  if the salesman had typed it. Typing replaces it (override); clearing it back to blank
  falls back to the default again.
- **Display** (so it reads right before/while in cart too): effective manual price =
  **`entered ?? snapshotPrices?.[id] ?? p.price_paise`** (typed wins, then the edit-snapshot,
  then the default — so editing an existing order never re-prices a line).
  - `priceLabel` (manual): `formatRupees(effective)` when non-null, else "Tap to price".
  - `inputVal`: `buffered ?? (effective != null ? String(effective / 100) : "")` — the box
    shows the default, fully editable.
- Net: the screenshot's empty "₹ Unit price" now shows the imported LG default; adding the
  line to the cart bills it at that default with no extra taps, and the total reflects it.

## 4. Server fallback (migration — recreate the manual branch of two RPCs)
Belt-and-suspenders: the client (step 3) now normally *sends* the default, but the server
also falls back to it if a manual line ever arrives without a price (e.g. a new line added
during an edit) — so the default is authoritative either way:
- **`submit_order`** and **`update_order_items`**, manual branch: change
  `v_unit_price := (item->>'unit_price_paise')::int` to
  **`v_unit_price := coalesce((item->>'unit_price_paise')::int, v_product.price_paise)`**,
  then keep the existing validation (`> 0`, `<= ceiling`; reject if still null — a manual
  product with neither an entry nor a default). Everything else byte-identical.
- **Do not touch the fixed-brand branch** (catalog price snapshotted server-side, client
  price ignored — untamperable stays).
- Standard **14-digit `YYYYMMDDHHMMSS`, no `T`**; apply via MCP; reconcile the repo
  filename to the ledger version. Regenerate types (no signature change → likely no diff).

## Acceptance (reviewer verifies by execution — live, rolled back)
- Importing an LG (manual) sheet with a `Price` column sets `products.price_paise` (the
  default); a blank price still imports as TBD/null.
- Quick Order: an LG product **with** a default shows that price on its line **and**
  pre-filled in the unit-price input; **adding it to the cart without tapping the price**
  bills it at the default — the **line total and cart total reflect it immediately** (not
  ₹0), and the submitted `order_items.unit_price_paise` equals the default. Overwriting the
  box submits at the override; clearing it falls back to the default. Prove all three.
- An LG product **without** a default still reads "Tap to price" / empty input and is
  **rejected** if submitted blank (as today).
- **Fixed brands unchanged**: catalog price authoritative, a forged client price still
  ignored (execute to prove the untamperable path didn't regress).
- Editing an existing manual order doesn't re-price existing lines (snapshot wins over
  default); a newly-added manual line with no entry falls back to the default.
- `npm run build` + `tsc` + eslint clean; migration reconciled.

## Guardrails
- The manual default is **not** authoritative — override allowed above or below, **no
  floor** (unchanged trust model). The only additions are a pre-fill + a server fallback.
- **Never** let the manual fallback bleed into the fixed-brand path (fixed stays
  catalog-authoritative + client-ignored).
- Money in paise end to end (`parsePricePaise` on entry, `formatRupees` on display); don't
  touch the ceiling or the `> 0` rule.
- Snapshot-at-submit immutability holds: `order_items.unit_price_paise` is still the frozen
  price; the default only seeds a fresh line, it never rewrites a placed one.
