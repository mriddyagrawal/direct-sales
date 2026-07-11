# Builder prompt — Orders UI revamp (mobile): list + detail, glyph system, salesman nav

A front-end revamp of the orders experience per the owner-approved mockup. **Read
[docs/specs/orders-ui.md](../docs/specs/orders-ui.md) first — it is the full spec**
(panels 7a–7f described in words, since the mockup is images only). Keep that doc
in sync if anything shifts during the build. State-machine context:
[docs/specs/order-lifecycle.md](../docs/specs/order-lifecycle.md).

**This is UI only. Zero backend changes** — no migration, no RPC, no RLS. The state
machine already matches (lifecycle overhaul, `20260709200230`). Every write still
goes through the existing role-guarded RPCs.

## Owner decisions baked into the spec (do not "fix" these back to 7f)
1. **Billed is not terminal** — an **admin** keeps a **Cancel** on a billed order.
2. **Salesman self-cancel stays** — own order, `pending_approval`, in-window.
3. **Deposits** is a live, tappable nav tab → **"Coming soon!"** placeholder page.

## Files (all real, on `main`)
- List: [src/components/orders/OrdersView.tsx](../src/components/orders/OrdersView.tsx) + `OrdersView.module.css`. Rendered by [src/app/page.tsx](../src/app/page.tsx) (salesman, `role="salesman"`) and [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx) (staff, `role="staff"`).
- Detail: [src/components/orders/OrderDetailView.tsx](../src/components/orders/OrderDetailView.tsx) + `.module.css`, fed by [src/components/orders/order-detail-data.ts](../src/components/orders/order-detail-data.ts) (`ORDER_DETAIL_SELECT` / `toOrderDetailProps`). Rendered by `src/app/orders/[id]/page.tsx` (salesman) + `src/app/dashboard/orders/[id]/page.tsx` (staff).
- Nav: [src/components/BottomTabBar.tsx](../src/components/BottomTabBar.tsx) (salesman) + the staff `DashboardNav`.
- Status plumbing: `src/lib/order-status.ts` (`getOrderStatusTag`), `src/components/ui/StatusTag.tsx`, `src/lib/format.ts` (`formatRupees` — money is paise, always format), `src/lib/order-events.ts`.
- Model/serial pattern to copy: the pick slip already reads `products(tally_name)` gated on `brands.show_model` — see `src/app/orders/[id]/pdf/route.ts` + `PickSlipPdf.tsx` and the godown `PickScreen`.

## Data layer — one small change (still no DB change)
`ORDER_DETAIL_SELECT` currently has `brands(name, code)` and
`order_items(id, product_id, product_name, unit_price_paise, qty, line_total_paise, position, order_item_scans(...))`.
Add, for the model eyebrow + names-only footnote:
- `brands(name, code, show_model)`
- `order_items(… , products(tally_name))` (the current product's model — display-
  only, same as the pick slip; the snapshot `product_name` stays the display name).

Thread `showModel` (from `brands.show_model`) and each line's `tally_name` through
`toOrderDetailProps` → `OrderDetailData` / the item row → `OrderDetailView`. The
list (`OrdersView`) does **not** need model data — leave `ORDERS_SELECT` alone.

## Build it in atomic commits (our norm — one concern each)
1. **`lucide-react` + glyph convention.** Add the dep; a tiny `Icon` usage
   convention (18px, strokeWidth 1.75, `aria-hidden`, always paired with a label).
2. **Salesman nav.** `BottomTabBar` → **Orders** (`receipt-text`, `/`) + **Deposits**
   (`wallet`, `/deposits`); New Order leaves the bar. Add `/deposits` route =
   **"Coming soon!"** placeholder in the app shell. Staff `DashboardNav` gets
   glyphs + labels (Orders/Retailers/Products/Users).
3. **New Order FAB.** Floating `+ New Order` (accent, bottom-right) for both roles;
   list gets bottom padding so it never covers the last card.
4. **Orders list card + title.** Rebuild the mobile card per §2 (ref eyebrow ·
   retailer + amount bold · one grey meta line; salesman drops the salesman name;
   pending-approval amber left-border; cancelled amount struck-through). Title
   **My orders** for salesman, **Orders** for staff. Restyle the tab chips. Hide
   the `(/)` hint on mobile.
5. **Detail: hero + primary-action-by-status + glyph secondaries.** Promote
   retailer into the header (name + `area · phone · salesman`). Primary button
   follows §5 (Approve / Mark billed / Share PDF / none). Secondaries Edit · Share ·
   Cancel as glyph+label, **Cancel red at the far end**. Keep admin **Cancel on
   billed**; keep salesman self-cancel (pending, in-window). Wire nothing new — the
   handlers (`approveOrder`, `processOrder`, `cancelOrder`, `SharePdfButton`)
   already exist.
6. **Detail: items table by brand shape.** Model eyebrow (`tally_name`) + serials
   **nested under each line** for `show_model` brands; the italic **"captured at
   picking, after approval"** placeholder when not yet picked (`pending_approval` /
   `approved`); names-only footnote for fixed brands. Serials stay **staff-only**
   (salesman sees the model eyebrow, not serial rows). Keep `Copy serials`.
7. **The `approved` / "Waiting for scan" screen (§4).** Chip "Approved · waiting for
   scan"; **no loud primary** + the line "Waiting for the godown to scan serials.";
   the **`approved → billed` admin override as a quiet secondary** Mark billed;
   serials show the placeholder. Salesman lens keeps its green note + Share PDF.
8. **Docs.** Reconcile `docs/specs/orders-ui.md` (and any drift into
   `salesman-app.md` / `accountant-dashboard.md`) with what shipped.

## Acceptance (reviewer verifies by execution)
- **List:** salesman title **My orders**, no salesman/brand filters, meta line has
  no salesman name; staff title **Orders** with both filters. Cards match §2;
  pending-approval has the amber left edge; a cancelled order's amount is struck.
  New Order is a FAB; the last card is never covered. Realtime + keyboard nav still
  work.
- **Detail primary action tracks status** exactly per §5: pending→Approve (admin
  only; accountant sees none), ready_to_bill→Mark billed, billed→Share PDF **with an
  admin Cancel still present**, cancelled→Share only. Salesman can Edit/Cancel his
  own pending in-window order and nothing after.
- **Approved screen:** an approved LG order shows "waiting for scan", no loud
  primary, and an admin **can** still Mark billed via the override secondary.
- **Brand shape:** an LG order shows model eyebrows + nested serials (staff) / model
  only (salesman); a Zebronics order shows plain lines + the names-only footnote,
  no eyebrow, no serial rows.
- **Glyphs:** every action/nav item is icon **+** label; nothing icon-only; lucide
  bundled locally (no network icon request).
- `/deposits` renders "Coming soon!" and is reachable from the salesman bar.
- `npm run build` + `tsc` + eslint clean.

## Guardrails
- **No backend/DB/RPC/RLS change.** UI + the one additive `ORDER_DETAIL_SELECT`
  field list only. If you feel you need a policy change (e.g. salesman serials),
  **stop and flag it** — it's explicitly out of scope.
- **Money stays paise → `formatRupees`.** Never render raw paise; keep the
  "Total (incl. GST)" label as-is (it's a label, not a computed tax).
- **Serials remain staff-only** (RLS already returns none to the salesman — don't
  work around it).
- Icons **must** bundle locally (lucide-react) — no CDN/external fetch (matches our
  CSP posture).
- Don't regress: Supabase Realtime on the list, the keyboard nav (`/ ↑↓ ↵`), the
  2h edit window, the D8 self-cancel hiding, and admin-only approval.
- Keep `docs/specs/orders-ui.md` the source of truth — update it if you deviate.
