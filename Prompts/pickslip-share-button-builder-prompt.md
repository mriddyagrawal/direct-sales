# Builder prompt — Pick slip: mobile Share button (Web Share API)

## What
Add a **Share** button to the pick slip (S10, `src/app/dashboard/orders/[id]/pick-slip/PickSlip.tsx`), beside the existing **Print** button. On a phone it opens the **native share sheet** (WhatsApp, etc.) via `navigator.share`, sharing the order as **formatted text** — so the accountant/salesman can fire an order off to the godown or the retailer from their phone.

## Why text, not a link
The pick-slip page is auth-gated — a shared **link** is useless to a non-user recipient. Share the **content** (ref, retailer, lines, total) as plain text.

## The change — frontend only (`PickSlip.tsx` is already `"use client"`)
- Add a **Share** button in `.chromeControls`, next to Print (screen chrome — keep it out of the print output; `.chrome` is already screen-only).
- **Feature-detect after mount** (avoid SSR/hydration mismatch — `navigator` is undefined on the server):
  ```ts
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  ```
  Render the Share button only when `canShare`. (Optional: a **Copy** fallback that writes the same text to the clipboard when share is unavailable — but the phone is the target, so hiding it on desktop is fine.)
- **On click:** build the text from the props, then `await navigator.share({ title: orderRef, text })`. **No `url`.** Wrap in try/catch and **swallow `AbortError`** (the user just cancelled the share sheet — not an error); ignore other errors quietly.
- **Respect the `pricesOn` toggle** — share exactly what's on screen: prices-off = qty + item ("PICK SLIP"); prices-on = include rate/amount + total ("ORDER COPY"). Same principle as Print.
- **Text format** (WhatsApp-friendly), reusing the existing `formatRupees` / `formatFullTimestamp`:
  ```
  GANPATI ENTERPRISES
  {orderRef}{brandName ? " · " + brandName : ""} — {pricesOn ? "ORDER COPY" : "PICK SLIP"}
  Submitted: {formatFullTimestamp(submittedAt)}
  Retailer: {retailerName}{area ? ", " + area : ""}{phone ? " · Ph " + phone : ""}
  Salesman: {salesmanName}

  {items.length} LINES
  {per item: "{qty} × {product_name}"}{pricesOn ? "  @ {formatRupees(unit_price_paise)} = {formatRupees(line_total_paise)}" : ""}
  {pricesOn ? "Total (incl. GST): {formatRupees(totalPaise)}" : ""}
  {notes ? "\nNotes: {notes}" : ""}
  ```

## Caveats
- **Secure context required:** `navigator.share` works on **HTTPS (the deployed Vercel URL)** and `localhost`, but **not over plain-HTTP LAN** (`http://192.168.x.x`) — same gotcha as the earlier `crypto.randomUUID` fix. Test on the deployed URL or localhost.
- **Text only** for now — sharing a PDF/image via `navigator.share({ files })` is a spottier, bigger follow-up; skip it.

## Acceptance
On a phone (deployed URL): the Share button shows, tapping it opens the native share sheet, and sharing to WhatsApp yields the formatted order text; the text respects the Prices on/off toggle; cancelling the sheet shows no error; on desktop/unsupported the button is hidden (or the Copy fallback works); Print and the rest of the pick slip are unchanged; `npm run build` clean. Reviewer verifies by execution **on a real phone / mobile viewport** — this is a mobile feature.

## Guardrails
Frontend only (`PickSlip.tsx` + its CSS). No backend/data changes.
