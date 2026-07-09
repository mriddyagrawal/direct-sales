# Builder prompt — Pick slip: a real generated PDF (replace window.print)

Replace the pick-slip **"Print"** button (currently `window.print()`, which on a phone produces a clunky browser-print of the page) with a **proper generated A5 PDF** the accountant/salesman can download and share (especially from a phone). Same content as the on-screen sheet ([PickSlip.tsx](../src/app/dashboard/orders/[id]/pick-slip/PickSlip.tsx)): it's now an **ORDER COPY** — always prices, and the **LG model (tally_name)** line under the display name.

## Recommended approach — a server route that streams the PDF
Cleanest phone UX (a real URL returning `application/pdf` → the phone opens it in its native viewer → share to WhatsApp from there), and keeps the PDF library **out of every client bundle**.

- **Dep:** `@react-pdf/renderer` (vector PDF from React-like primitives; runs server-side).
- **Route:** `src/app/dashboard/orders/[id]/pick-slip/pdf/route.ts` — a GET handler:
  - `export const runtime = "nodejs";` (react-pdf needs Node, not edge).
  - Fetch the order with the **RLS-scoped server client** (`@/lib/supabase/server`) — reuse the exact query the pick-slip `page.tsx` uses (incl. `brands(..., show_model)` and `order_items(..., products(tally_name))`). RLS is the access gate: a caller who can't see the order gets no row → return 404. **No new RLS/columns.**
  - `renderToBuffer(<PickSlipPdf … />)` (more reliable under Next bundling than streaming) → return a `Response` with `Content-Type: application/pdf` and `Content-Disposition: inline; filename="<order_ref>.pdf"`.
- **`PickSlipPdf`** (`.../pdf/PickSlipPdf.tsx`) — a `@react-pdf/renderer` `Document`/`Page` (A5) mirroring the sheet:
  - Header: **GANPATI ENTERPRISES**, the ref (large mono), brand name, an **ORDER COPY** badge.
  - Meta: Submitted (full timestamp), Retailer (name, area, phone), Salesman.
  - `{n} LINES`, then a table: **QTY · ITEM · RATE · AMOUNT**. The ITEM cell shows `product_name`, and for `show_model` brands a second **model line** (`tally_name`) beneath it (like the on-screen `.slipModel`). **Always prices.**
  - **Total (incl. GST)** row, Notes box (if any), **Packed by / Checked by** signature lines, footer (printed timestamp).
  - Money via `formatRupees` (works in Node), timestamps via `formatFullTimestamp`.
  - **Fonts:** start with react-pdf's built-ins — **Helvetica** for structure, **Courier** for the mono figures — to avoid font-registration friction. (Registering Space Grotesk / JetBrains Mono via `Font.register` is a nice follow-up, not required for v1.)
- **The button:** in `PickSlip.tsx` (or its page), replace the **Print** button with **"Download PDF"** — a link to the pdf route (`<a href={`/dashboard/orders/${orderId}/pick-slip/pdf`} target="_blank" rel="noopener">`). `PickSlip` will need the order **`id`** passed in (the page has it from params). Keep the on-screen HTML sheet as the visual preview; keep the **Share** button. You may drop the now-unused print `@media print` CSS and the unused `.toggle*` classes.

## Alternative (only if server bundling of react-pdf fights Next)
Client-side generation: dynamic-import `@react-pdf/renderer` in a client button, `pdf(<PickSlipPdf … />).toBlob()`, then download via an object URL (filename `<ref>.pdf`) — and where `navigator.canShare?.({ files: [file] })` is true, offer share-the-file. Dynamic-import so it stays off the salesman/accountant/admin bundles. Same `PickSlipPdf` component either way.

## Acceptance (reviewer + owner phone test on the deployed URL)
- Tapping **Download PDF** on a phone yields a clean, correctly-laid-out **A5 PDF** — GANPATI ENTERPRISES header, ref, ORDER COPY, meta, the items table **with prices**, the **LG model line** for LG orders, total incl. GST, notes, signatures — **not** the browser-print output. Opens in the phone's PDF viewer and is shareable to WhatsApp.
- Filename is the order ref; a fixed-brand (Zebronics/Luminous) order shows no model line; a non-authorized user (or bad id) gets 404 (RLS).
- The PDF library is **absent from the client bundles** (server route) — or, if the client fallback is used, only in the pick-slip chunk.
- `npm run build` + `tsc` + eslint clean.

## Guardrails
- Pick-slip only. **No schema / RLS / RPC changes** — the pdf route reuses the RLS-scoped server client, which is the access control.
- Money is integer paise → `formatRupees`; never show raw paise.
- Don't regress the on-screen sheet, the Share button, the model line, or the always-on prices.
