# BUILDER task — one table grammar, then Retailers gets a desktop table and a detail route

Owner-approved 2026-08-01. **No DB work anywhere in this spec.** Every column it
reads already shipped. If you think you need a migration, stop and ask.

**The product is live and in use. All of this happens on ONE branch — do not
commit to `main`, and do NOT push.** (Owner 2026-08-01, superseding both the
earlier branch-per-step plan and the Vercel-preview idea.)

The loop, after **every** commit:

1. Commit to the branch. **Do not push.** Nothing leaves this machine until the
   whole run is signed off.
2. Start the app on localhost (`npm run dev`) and leave it running.
3. Tell the owner it is up, and say plainly **what changed and what to look at** —
   which pages, which surface, phone or desktop.
4. Wait. The owner clicks through it and comes back with how it feels.
5. Only then move to the next step.

The steps below are the commit order, and each one leaves the app working — that
property is what makes this loop possible at all. Push and merge happen once,
at the end, after every step has been looked at.

**Note on localhost vs production:** Next's route prefetching is a **no-op in dev**.
The Orders desktop hover trail therefore will NOT reproduce on localhost. That is
expected, it is pre-existing behaviour, and nothing in this task should be judged
by its absence there.

---

## Why

There is no shared table style. `.table` is copy-pasted into **four** CSS modules,
and they have drifted:

| | Orders | Products | Users | ImportWizard |
|---|---|---|---|---|
| `thead th` `padding-right: 12px` | yes | yes | **missing** | yes |
| `thead th.numeric` right-align | yes | yes | **missing** | — |
| `td.cellMeta` colour | **`#747b88`** | `var(--color-locked)` | `var(--color-locked)` | — |
| `tr.clickable:hover` | **none** | `rgba(29,78,216,0.05)` | same | — |

Two of those are real bugs. **Users' column headers sit 12px out of alignment
with their own values** — and Products' CSS carries a comment warning about
exactly that mistake. **Orders' meta text uses a lighter grey than the token**
(`#747b88` vs `#6b7580`), so the busiest table has the weakest contrast on its
secondary text.

Retailers is the fifth case: it has **no table at all**, only cards on both form
factors, while Orders, Products and Deposits all hide a table on phone
(`display: none`) and show it from `768px`. Retailers is the outlier, and adding
a table there naively would create a fifth copy that starts out already carrying
Users' bug.

**Deposits is deliberately out of scope.** Its table is a genuinely different
object — no top rule, no zebra, no fixed row height, padding-sized headers.
Making it match would change what it *is*, not tidy it. Leave it alone.

---

## Decisions (settled — do not re-open)

**Meta-cell grey → `var(--color-locked)`.** Orders' hardcoded `#747b88` is the
lighter of the two, so it currently has the *worst* contrast on text that is
already secondary. Orders gets slightly darker. Expected and approved.

**Header letter-spacing → a new token, `--text-table-head-tracking: 0.06em`.**
All four tables hardcode `0.06em` today. The existing `--text-section-label-tracking`
is `0.08em` and is used in ~21 places, but every one of those is a *section label
in a form or flow*, never a dense table header — so 0.06em is a real, if
undocumented, sub-convention rather than drift. Adopting the 0.08em token would
visibly loosen four table headers for no benefit. **Add the new token in
`globals.css` next to the others; the visual result is identical to today.**

**Row hover → `rgba(29, 78, 216, 0.05)`.** Orders' `.rowSelected` stays at
`0.06` and is NOT unified: it is keyboard-selection state, not hover, and those
two should not look identical.

**Retailers row click → the detail page. Edit lives there.** Matches Orders. The
usual objection (it slows the verification queue) was measured and is void:
**0 shops are pending verification.** There is no batch workflow to protect.

**The Tally ledger name stays a real field in the editor, and never appears in
the list (owner 2026-08-01).** Measured: of 599 active shops, **596 have
`tally_ledger_name` identical to `name`, 1 differs, 2 unset** — so it is an
editing concern, not a scanning one.

- **Editor (detail page, and the quick-add):** keep it as a normal labelled
  field, plainly distinct from Shop name. No collapsing, no disclosure widget —
  the owner wants it visible and editable where a shop is being edited.
- **Retailers table and cards: do not show it, in any form.** No Tally column, no
  second line under the name, nothing. The list shows the shop's name. Two
  near-identical names side by side on 599 rows is noise that would make the list
  harder to scan for no gain.

Keep the **column** regardless of how it is displayed: it is what makes renaming
a shop safe. The display name is for humans and will be edited; the ledger link
must not move when it is, or a typo fix silently re-points real money.

---

## The canonical grammar

Create **`src/components/ui/table.module.css`**. The project has never used
CSS-Modules `composes:` and has exactly one global stylesheet, so follow the
house sharing pattern — `src/components/ui/`, same as `Button` and `Field`.

**Share the stylesheet, not the markup.** Do not build a generic `<DataTable>`
with column configs; the four tables differ in columns, cell classes and row
semantics, and that abstraction rots. Each page keeps its own `<table>` markup and
imports the grammar:

```tsx
import table from "@/components/ui/table.module.css";
<table className={table.table}>
```

Page-specific column widths stay in the page's own module and compose alongside:
`className={`${table.cellMeta} ${styles.wide}`}`.

The grammar is Products' block verbatim, with the three fixes folded in:

```css
.table {
  display: none;                 /* phone: cards render instead */
  width: 100%;
  border-collapse: collapse;
  border-top: 2px solid var(--color-ink);
}
.table thead th {
  text-align: left;
  font-family: var(--font-figures);
  font-size: var(--text-section-label-size);        /* was hardcoded 10px */
  letter-spacing: var(--text-table-head-tracking);  /* NEW token, 0.06em */
  color: var(--color-locked);
  height: 32px;
  /* Match the body cells' 12px right padding so each header sits over its
     column's values, not 12px off. This is the fix Users was missing. */
  padding-right: 12px;
  border-bottom: 2px solid var(--color-ink);
}
.table thead th.numeric { text-align: right; }
.table tbody tr {
  height: 40px;
  border-bottom: 1px solid var(--color-hairline);
}
.table tbody tr:nth-child(even) { background: rgba(20, 24, 31, 0.02); }
.table tbody tr.clickable:hover { background: rgba(29, 78, 216, 0.05); }
.table td {
  font-family: var(--font-structure);
  font-size: var(--text-body-size);
  color: var(--color-ink);
  padding-right: 12px;
}
.table td.cellMeta { color: var(--color-locked); font-weight: 400; }
.table td.cellName { color: var(--color-ink); font-weight: 600; }

@media (min-width: 768px) {
  .table { display: table; }
}
```

---

## The six steps, in this order

The order front-loads risk onto the page that matters least. **Each step is a
branch, a review and a merge — the app works after every one.**

**1 — `table.module.css` + the token.** Nothing imports it yet. Zero risk.

**2 — Migrate Users.** Admin-only, lowest traffic, and migrating *fixes* its
header misalignment, so the first migration pays for itself. If the grammar is
wrong you find out on the page nobody is watching. (Users has no numeric columns,
so `.numeric` is simply unused there — that is fine, not an omission.)

**3 — Migrate Products.**

**4 — Migrate ImportWizard.**

**5 — Migrate Orders.** Last: busiest page, and the one whose grey visibly
changes. Do **not** touch its `onMouseEnter` prefetch or `.rowSelected` logic in
this step — styles only.

**6 — Retailers: desktop table + phone cards + detail route.** Details below.

---

## Step 6 in detail

**Keep the phone cards exactly as they are.** Phone layouts are owner-final.

**Add the desktop table** using the shared grammar, mirroring the columns the
cards already show. The badges (`NEW` / `NOT SYNCED` / `DEACTIVATED`) currently
sit inline after the name and shove it around, so name start-positions vary row
to row — in the table they become a **STATUS column** and the names left-align.

### Navigation — two mechanisms, forced by HTML

**Phone cards → a real `<Link>`**, exactly like Orders' cards. Next prefetches the
detail route's loading boundary as each card scrolls into view, and you get
long-press, open-in-new-tab and correct screen-reader semantics for free.

**Desktop rows → do NOT copy Orders' `<tr onClick={router.push}>`.** That pattern
was measured on 2026-08-01 and it is the worse half of Orders: its `onMouseEnter`
sets React state, re-rendering the entire unmemoized row list on every row the
cursor crosses (this is the visible "hover trail" on the Orders page), and it
loses middle-click, open-in-new-tab and link semantics entirely.

Instead, put a **real `<a>` in the name cell and stretch it over the row**:

```css
.table tbody tr { position: relative; }
.rowLink::after { content: ""; position: absolute; inset: 0; }
```

One anchor does all the work — automatic prefetch, keyboard focus, new tab,
screen readers — with no click handler and no re-render. Any other interactive
element in the row needs `position: relative` to sit above the stretched link.

### The detail route

`/dashboard/retailers/[id]` — build it **minimal**: name, area, phone, verified /
active status, `tally_ledger_name`, and the edit action moved here from
`RetailerModal`. Roughly thirty lines. Without it the links point at a 404 and
nobody can test what you just built.

The balance and statement land here later; leave room, build neither now.

**Consequence to handle:** `RetailersQueue.tsx:148` currently does
`onClick={() => setEditing(r)}` — clicking a row opens the edit modal. That entry
point moves to the detail page. Decide deliberately what happens to
`RetailerModal` (retire it, or keep it only for the Add flow) rather than
leaving two ways to edit.

---

**7 — Consolidate the FAB.** Last, and only after step 6 has been looked at.

The FAB **bug is already fixed** (d5c49cf): all four now agree on `bottom`,
`min-height`, `padding`, `border-radius`, `font-size` and `box-shadow`, and
`bottom: calc(86px + …)` is correct against the 70px bar. **Nothing here is
user-visible** — this step is purely removing the duplication that let it drift,
which is why it goes last and can be dropped without affecting anything else.

Same treatment as the table: **`src/components/ui/fab.module.css`**, imported by
the four pages, page-specific bits staying local. Two differences are deliberate
and must survive:

- Orders and Deposits keep the FAB on desktop and reposition to `bottom: 32px`.
- Products and Retailers `display: none` theirs at 768px — those pages have a
  desktop Add button instead.

Also delete the stale comment above the Products FAB
(`ProductsPricing.module.css:506`): it still says the bottom bar is **60px**,
which is the exact wrong number the `76px` bug was computed from. The correct
note already sits three lines below it.

---

## Out of scope

**Deposits' table.** Different object, deliberately — no top rule, no zebra, no
fixed row height, padding-sized headers. Making it match would change what it
*is*, not tidy it.

**The balance column and the ledger/statement page.** Next task. Adding one
right-aligned mono column to a shared table is cheap once this exists.
