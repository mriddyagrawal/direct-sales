# Builder prompt — S8 orders table: column weight/color hierarchy

**Scope:** desktop orders ledger only. Pure presentation — **no DB, no API, no logic changes.** Files: `src/app/dashboard/OrdersList.tsx` (table `<td>`s ~L218–226) + `src/app/dashboard/OrdersList.module.css`.

**Goal:** the ledger currently renders every column at the same ink weight, so the eye can't triage. Give it a visual hierarchy — primary scan targets stay full-ink, metadata recedes. This is the "so neat" effect from the reference: the time and salesman columns are lighter in weight *and* color.

**Changes (table rows only):**

| Column | Cell | Treatment |
|---|---|---|
| **SUBMITTED** (time) | L219, currently `.mono` | add muted: `color: var(--color-locked)`, `font-weight: 400` — keep the mono font |
| **SALESMAN** | L220, bare `<td>` | muted: `color: var(--color-locked)`, `font-weight: 400` |
| **RETAILER** | L221, bare `<td>` | emphasize: `color: var(--color-ink)`, `font-weight: 600` — it's *the* scan target |
| **REF** | L218 | no change (stays ink mono) |
| **TOTAL** | L226 | no change (stays ink mono, right-aligned) |

**Implementation:** add small semantic classes (e.g. `.cellMeta` for the muted pair, `.cellRetailer` for the emphasized one) and apply them to those `<td>`s. **Do not** style by `:nth-child` — the column set changes in the upcoming revamp, so position-based rules would break.

**Out of scope (comes in the revamp, don't touch):** the mobile card list, the header row, tab counts, the date control, the LINES column.

**Acceptance:** on desktop, SUBMITTED + SALESMAN are visibly lighter/greyer than REF/RETAILER/TOTAL; RETAILER reads as the boldest cell; REF and TOTAL unchanged. `npm run build` clean.
