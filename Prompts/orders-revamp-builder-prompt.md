# Builder prompt — S8 Orders page revamp (date-range filter · matching salesman dropdown · tab counts · drop LINES)

## What this is
Revamp the accountant/admin **Orders ledger (S8)** with a real date-**range** filter, a matching salesman dropdown, live per-tab counts, and a cleaner column set. **This is 100% frontend — no DB, no RPC, no migration.** Everything renders from data the page already fetches.

## Stack reality (don't fight it)
- Next.js 16 App Router + React 19 + Turbopack, **CSS Modules** (no Tailwind), `@supabase/ssr`.
- Design tokens in `globals.css`: `--color-ink` (#14181F primary), `--color-locked` (#6B7580 muted), `--color-accent` (#1D4ED8), `--color-hairline`, `--color-white`, `--font-structure` (Space Grotesk), `--font-figures` (JetBrains Mono, for numbers), `--radius` (2px). Use these — never hard-code colors.
- Money: integer paise → render with the existing `formatRupees`. Don't touch money handling.

## Already done — build on it, don't redo
- **Column weight/color hierarchy shipped (`839aff5`)**: SUBMITTED + SALESMAN muted (`--color-locked`), RETAILER bold ink. **Leave it intact** (except removing LINES, below).
- **`profiles.full_name` role strip (`9c9097b`)**: the salesman cell shows a plain name ("Mridul"), no "(salesman)". Nothing to do.
- **The `react-day-picker@^10` dep + the `/date-demo` spike are already committed (`34773e6`)** — you **promote from the spike**, you don't reinstall or reinvent it. Commit 4 deletes the spike.

## Reference implementation — a working spike already exists
The date picker is **already built and verified** at `src/app/date-demo/` (`DateRangeDemo.tsx` + `DateRangeDemo.module.css`). It already has:
- A **dropdown**: a fixed-width **280px trigger** (locked — box size/position never shifts; the value ellipsizes), a popover opening beneath it, closing on outside-click or **Esc**.
- A **preset rail**: Today · Yesterday · Last 7 days · Last 30 days · This month · All (each with a closing hairline).
- A **react-day-picker range calendar** themed to the instrument grammar: accent range, **2px square cells (not circles)**, **mono day numbers**, uppercase weekdays, selected digits at normal size (`.rdp-selected { font-size: large }` overridden).
- Plain-JS date helpers (no `date-fns` in our code) + `rangeLabel()` → `8 Jun 2026 — 7 Jul 2026` / `All dates`.

---

## Commit 1 — Shared filter-dropdown shell + controlled DateRangeFilter
**Goal:** one dropdown shell both filters share (so the salesman box and date box are pixel-identical), plus the promoted, controlled picker.

- Extract pure helpers into **`src/lib/date-range.ts`**: `startOfDay`, `addDays`, `startOfMonth`, `PRESETS`, `rangeLabel(range)`, and `export const DEFAULT_RANGE = <"Last 30 days">()`. Importable by both the components and `OrdersList`.
- Create a shared shell **`src/app/dashboard/FilterDropdown.tsx`** + `.module.css`: a **fixed-width trigger** rendering `[ CAPTION  value  ▾ ]` (caption in mono `--color-locked`, value bold ink with `text-overflow: ellipsis`, chevron right), controlled **open** state with **outside-click + Esc** close, and a popover anchored below-left. Props roughly `{ caption: string; valueLabel: string; width?: number; children: ReactNode }` (children = popover body). **Responsive:** on ≥768px the popover is anchored/auto-width; on narrow screens it drops to **full container width** (and the date picker's presets rail may wrap above the calendar) so nothing overflows a phone — the dashboard is phone-responsive.
- Create **`src/app/dashboard/DateRangeFilter.tsx`** (controlled: `{ value: DateRange | undefined; onChange }`; no internal *range* state) built on `FilterDropdown` with caption `DATE`, `valueLabel={rangeLabel(value)}`, and the presets-rail + calendar as the popover body. Reuse the demo's CSS/theming verbatim.
- Keep `/date-demo` working by having it render `<DateRangeFilter>` in a local `useState` wrapper (stays testable until commit 4).

**Files:** new `src/lib/date-range.ts`, `src/app/dashboard/FilterDropdown.tsx` (+css), `src/app/dashboard/DateRangeFilter.tsx` (+css); edit `src/app/date-demo/DateRangeDemo.tsx`.
**Acceptance:** `npm run build` clean; `/date-demo` behaves as before; `DateRangeFilter` holds no range state; the popover does **not** overflow at a 375px-wide viewport.

## Commit 2 — Wire the range filter into the ledger (default: Last 30 days) + filter-row layout
In `src/app/dashboard/OrdersList.tsx`:
- Delete `type DateFilter`, the `dateFilter` state, and the all/today/yesterday `<select>`.
- Add `const [range, setRange] = useState<DateRange | undefined>(DEFAULT_RANGE)` (import `DEFAULT_RANGE`, `rangeLabel` from `@/lib/date-range`; `DateRange` from `react-day-picker`).
- Render `<DateRangeFilter value={range} onChange={setRange} />`.
- **Filter predicate:** include an order when `range` is `undefined` (All) **or** its IST day is in `[from, to]` inclusive — compare `istDateKey(new Date(o.submitted_at))` against `istDateKey(range.from)` and `istDateKey(range.to ?? range.from)` (YYYY-MM-DD string compare is chronological; mirrors the current today/yesterday IST logic — assumes an IST browser, same as today).
- **Header:** `{n} orders · {rangeLabel(range)}` (e.g. `7 orders · 8 Jun – 7 Jul 2026` / `· all dates`).
- **Filter-row arrangement (match the mock):** status tabs on the **left**, salesman + date + search grouped on the **right**, and the whole row sits **flush on the table's top rule** (no gap) so the active tab can connect to it — see the tab-strip visual in commit 3.

**Files:** `OrdersList.tsx` (+ its module.css for the row layout).
**Acceptance:** default = last 30 days; **All** shows everything; presets + a dragged range filter live; header count/label track the selection; DATE box never shifts; tabs-left / filters-right layout.

## Commit 3 — Live per-tab counts + folder-tab strip
Refactor filtering into two stages in `OrdersList.tsx`:
- `scoped` = orders passing **salesman + range + search** (everything except the status tab).
- Counts from `scoped`: `all = scoped.length` + one `.filter()` each for `submitted` / `processed` / `cancelled`.
- `finalFiltered = status === "all" ? scoped : scoped.filter(o => o.status === status)` (table + keyboard nav render from this).

**Tab-strip visual (owner reference image):** each tab renders `Label` (ink) + `count` (muted `--color-locked`) — e.g. `All 7`, `Submitted 6`, `Processed 0`, `Cancelled 1`. The strip's baseline is the **table's 2px top rule**. The **active** tab is a **white, hairline "folder tab"**: `1px --color-hairline` border on top/left/right, **2px top corners** (`--radius`), **no bottom border**, its bottom edge sitting on (overlapping ~1px) the table's top rule so it reads as a physical tab connected to the ledger. Inactive tabs are plain text (no border/background). This **replaces** the current accent-bordered-box active state (`.filterTabActive`). The active label may be semibold, but the **outline — not color — is the active signal**.

**Acceptance:** counts reflect the salesman + range + search scope, update live (incl. Realtime inserts), stay stable across tab switches, and `submitted + processed + cancelled === all`; the active tab renders as an outlined folder-tab connected to the table's top rule with a muted count; inactive tabs are plain text.

## Commit 4 — Matching salesman dropdown · drop LINES · remove the spike
- **Salesman filter → custom dropdown matching DATE.** Create **`src/app/dashboard/SalesmanFilter.tsx`** on the shared `FilterDropdown` shell: caption `SALESMAN`, `valueLabel` = the selected salesman's name or `All salesmen`, popover body = a simple option list (`All salesmen` + each `salesmen[]` entry) that calls `onChange(id)` and closes. Replace the native `<select>` in `OrdersList.tsx`. Both boxes now look identical.
- **Drop LINES:** remove `<th>LINES</th>`, its `<td>`, the `· N lines` in the mobile `cardMeta`, and **`order_items(count)` from `ORDERS_SELECT`**. Check `src/app/dashboard/page.tsx`'s initial fetch and drop the line-count join there too if present.
- **Delete `src/app/date-demo/`** (spike no longer needed).

**Acceptance:** salesman + date boxes are visually identical (caption + value + chevron, same fixed-box behavior); no LINES anywhere on S8; the `order_items(count)` join is gone; `/date-demo` 404s; `npm run build` clean; the `839aff5` column hierarchy still reads correctly.

---

## Guardrails
- **No DB / RPC / migration work.** Frontend only.
- **Do NOT change the status chip.** Keep `getOrderStatusTag` / `src/lib/order-status.ts` exactly as-is — the chip stays `Submitted · editable 15m` / `Submitted · locked` / `Processed` / `Cancelled` (owner decision: keep the "Submitted ·" prefix).
- **Don't add Phase-3 statuses** (`pending_approval`, `approved`) or a brand column now — but keep the **status-tab list and `StatusTag` tones data-driven** so they slot in later without a rewrite. (Future shape: `docs/specs/order-lifecycle.md`.)
- **Keep client-side filtering** (pilot scale). Add a one-line comment marking the bounded-initial-fetch seam for when volume grows — don't build it.
- Don't re-touch the column weight/color hierarchy beyond removing LINES.
- Both filter controls **must share `FilterDropdown`** — no divergent one-off dropdown.
- Each commit must compile and leave the app runnable — the reviewer verifies by execution (`/dashboard`, exercise the filters at desktop **and** a narrow viewport), not by reading.
