# Builder prompt — Godown scanner: targeting fixes (torch + format hints + scan-region crop + serial filter)

Follow-up to the godown fulfilment feature. The scanner works but **grabs the wrong barcode**: LG boxes have 3 barcodes (serial `CODE_128`, an `EAN-13` `8806091898456`, sometimes a QR), and ZXing decodes the **entire camera frame** so it locks onto the easy EAN/QR instead of the serial. Four targeted changes to the godown pick screen's scanner component (`src/app/godown/[id]/...`), all in the scan loop. Design context: [docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md).

## The core architectural change
Replace ZXing's whole-frame `decodeFromVideoDevice` with **our own stream + cropped-canvas decode loop** — this is what makes torch, format-restriction, and scan-region all possible:

1. `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } })` → attach to the `<video>` (kept small on screen). **No resolution cap — use the device's native resolution.**
2. A **throttled** decode loop: draw **only the reticle sub-region** of the video onto an offscreen `<canvas>`, then `reader.decodeFromCanvas(canvas)` inside try/catch (`NotFoundException` → keep looping).
3. Reuse the existing line-first UI, progress, submit-batch, and the per-line manual "Or type a serial…" field unchanged.

## Keep it light (hard requirement — phone-first, must stay snappy)
The crop loop must be **lighter** than the current whole-frame decode, not heavier. Cropping already helps (fewer pixels per decode than the full frame); on top of that:
- **Throttle to ~8–10 decodes/sec** (e.g. `setInterval` at 100–120ms, or rAF gated by a timestamp). **Do NOT decode on every animation frame** (60fps of full decodes is the only way this gets heavy). This throttle — not resolution — is what keeps it light.
- **Capture at native resolution** (no `getUserMedia` cap — owner decision: better focus + detail helps read the dense Code128). Keep decode cheap by decoding the **crop**, and on a very high-res sensor **downscale the decode canvas to ~1280–1600px wide** when drawing (preserves barcode detail, keeps the decode fast).
- **Decode the crop only** — never the full frame.
- **Preload the ZXing reader on `/godown` mount** — dynamic-import (`await import("@zxing/browser")`) as soon as a godown user lands after login, so the first pick opens with no fetch delay. It stays **route-code-split** (only in the godown chunk, never in the salesman/accountant/admin bundles).
- **Reuse one offscreen canvas + one reader instance** across ticks (don't allocate per frame).
- Stop the loop + camera + torch the instant the pick completes or the screen unmounts.

## 1. Serial content-filter (the targeting fix)
On every successful decode, run it through the existing `extractSerial(text)`:
- **`parsed === true`** (matches `\d{3}[A-Z]{4}\d{6}`) → accept: add the serial to the active line (dedupe within order, respect qty cap).
- **`parsed === false`** (EAN `8806091898456`, model `P7510RGAZ`, etc.) → **silently ignore and keep scanning.** Do **not** pop the "that doesn't look like an LG serial" card on a scan.
- The auto fix-it/confirm card is **removed from the scan path** — manual entry is only the deliberate per-line "Or type a serial…" field (typing there + Add stores the value as-is, the intended override).

## 2. Torch ON by default
After the stream starts, get the video track (`video.srcObject.getVideoTracks()[0]`), and if `track.getCapabilities?.().torch` is true, `await track.applyConstraints({ advanced: [{ torch: true }] })`. 
- Default **on**; provide a small toggle to turn it off (some units are very reflective) — but it starts on.
- **Graceful degrade:** iOS Safari and any device without torch capability → skip silently (no error, no crash). Turn torch off + stop the track on unmount.

## 3. Restrict formats (kills EAN + QR at the decoder)
Construct the reader with format hints so it only attempts linear alphanumeric symbologies:
```ts
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93]);
const reader = new BrowserMultiFormatReader(hints);
```
This means the **EAN-13 and QR are never decoded** — belt-and-suspenders with the content-filter. (The LG serial barcode reads as `CODE_128`; keep `CODE_39/93` as backups for any older labels.)

## 4. Scan-region crop (only the visible window is decoded)
The small on-screen box is currently just CSS while ZXing reads the full frame — that's why a QR **above** the visible window still scanned. Fix by decoding only the reticle region:
- Render a **centered, landscape** reticle (barcodes are wide/short — a wide short box scans best), e.g. 90% width × ~28% height, centered.
- Each decode tick: compute that reticle rect in the video's **intrinsic** pixel coordinates (`video.videoWidth/Height`, accounting for the element's `object-fit`), `ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)` into the offscreen canvas, and decode **that canvas only**.
- WYSIWYG: what's inside the on-screen reticle is exactly what's decoded; anything outside (the EAN to the side, a QR above) is not in the canvas and can't be read.
- To keep the mapping simple, prefer `object-fit: cover` with a known crop math, or letterbox the video so on-screen↔intrinsic is a clean scale factor.

## Acceptance (reviewer + owner device retest on the deployed HTTPS URL)
- Pointing at an LG label with the **torch on**, the scanner **ignores the EAN and any QR**, and locks onto the **serial** barcode → adds `606NWFG207155`-style serials; progress advances; no fix-it card interrupts.
- A barcode (EAN/QR/other linear code) **outside the on-screen reticle** but in the camera's full view is **not** scanned.
- Torch turns on automatically on Android; on a device without torch it degrades silently. Torch + camera stop cleanly on leaving the screen (no hot camera/flash left on).
- Manual "Or type a serial…" still works for a genuinely unreadable unit; Submit still gated on full per-line coverage; `submit_pick` unchanged.
- `npm run build` + `tsc` + eslint clean.

## Guardrails
- Scanner component + its CSS only — **no backend/RPC/RLS changes** (`submit_pick`, serials, state machine untouched).
- Don't regress line-first selection, progress, batch submit, or the manual-entry path.
- Camera lifecycle must be leak-free: stop all tracks + torch + cancel the decode loop on unmount / route-away / pick-complete.
- Secure-context + permission-denied still show the clear message + manual-entry fallback (unchanged).
- If the ZXing crop loop proves fiddly, `html5-qrcode` (native `qrbox` scan-region + `formatsToSupport` + torch) is an acceptable swap — but keep the existing godown UI/flow.
