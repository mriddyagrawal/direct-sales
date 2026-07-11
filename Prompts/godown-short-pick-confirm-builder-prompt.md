# Builder prompt — Godown short-pick confirmation ("PAKKA?")

When a godown worker submits a **partial** pick (fewer units than ordered), pop a confirmation
dialog first so it isn't accidental. **Client-side UX guard only** — it builds on Stage 1's
partial-pick → backorder (already shipped); **no backend change** (`submit_pick` already handles
partial + the split).

## Where
[src/app/godown/[id]/PickScreen.tsx](../src/app/godown/[id]/PickScreen.tsx) — the submit flow.
The screen **already computes everything needed**: `doneCount` (units scanned/picked = **x**),
`totalQty` (units ordered = **y**), and `shortfall = totalQty - doneCount`. `handleSubmit()` is the
real submit.

## Behavior
- On the **Submit/Done** tap: **if `shortfall > 0`** (short pick) → open the confirm dialog instead
  of submitting. **If `shortfall === 0`** (full pick) → submit directly, no dialog (unchanged).
- **Dialog** (reuse the shared `BottomSheet` — `src/components/ui/BottomSheet`, like the other
  confirm sheets):
  - Line 1 (bold heading): **PAKKA?**
  - Line 2: **Aapne {doneCount}/{totalQty} items hi add kiye hai.**  (x out of y)
  - **Confirm** → runs the existing `handleSubmit()` (submits → the server splits off the backorder
    as today). **Cancel** → closes the dialog, stays on the pick screen with the pick intact.
- Suggested buttons (Hinglish, for the warehouse — owner may tweak): confirm **"Haan, submit karo"**,
  cancel **"Nahi"**. The two message lines are **verbatim** as above.

## Applies to both scan routes
`PickScreen` backs both `/godown/[id]` and `/scan/[id]`, so the guard appears in both. It works for
LG (`doneCount` = serials scanned) and fixed brands (`doneCount` = picked qty) — the totals are
already mode-aware, so no per-brand branching needed.

## Acceptance
- A **short** pick (`doneCount < totalQty`) → tapping submit shows the **PAKKA?** dialog with the
  correct **{doneCount}/{totalQty}**; **Confirm** submits (→ backorder created as before); **Cancel**
  returns to the screen with the pick intact (nothing submitted).
- A **full** pick (`doneCount === totalQty`) submits with **no** dialog (no extra tap for the common
  all-in-stock case).
- The ≥1-unit submit gate + the backend split are unchanged (still server-enforced).
- `npm run build` + `tsc` + eslint clean.

## Guardrails
- **Client-side only** — no backend / RPC / RLS change; `submit_pick` already handles the partial + split.
- Full picks must **not** get the dialog.
- Don't touch the ≥1-unit submit gate or the pick logic — this is purely a confirm-before-*short*-submit.
