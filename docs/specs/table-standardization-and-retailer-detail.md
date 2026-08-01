# BUILDER task — one table grammar, then Retailers gets a desktop table and a detail route

Owner-approved 2026-08-01. **No DB work anywhere in this spec.** Every column it
reads already shipped. If you think you need a migration, stop and ask.

**The product is live and in use. Every step below is its own branch and its own
merge.** Do not commit straight to `main` for any of this — it touches four
pages people are using right now.

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

**The Tally ledger name is a disclosure, not a second field (owner 2026-08-01).**
Measured: of 599 active shops, **596 have `tally_ledger_name` identical to `name`,
1 differs, 2 unset.** So a co-equal second text input is heavy UI for something
that matches 99.8% of the time — the owner was right to push on this.

Keep the **column**; it is what makes renaming a shop safe (the display name is
for humans and may be edited; the ledger link must not move when it is, or a typo
fix re-points real money). Drop the second **input**:

- Show one **Shop name** field.
- Beneath it, a quiet line — `Tally ledger: MA Sharda Sales Kusmunda` — with a
  small edit affordance.
- **Expand it by default only when it differs from the name**, which today is one
  shop out of 599. Otherwise it stays collapsed and the form reads as one field.
- On save, `resolveTallyLedgerName` already does the right thing whether the
  control was touched or not — no logic change, this is presentation only.

Apply the same treatment on the salesman quick-add: the field stays optional and
secondary, and a salesman who never opens it is unaffected.

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

## Out of scope

**The FAB.** It has the identical disease — four copies across Orders, Deposits,
Products and Retailers, drifted three ways, and `76px` bottom on two of them
against a `70px` bar (should be `86px`; the `76` was computed when the office nav
was 60px). It needs the same cure and it gets its **own** pass. Tangling a
four-file table refactor with a four-file FAB refactor means one bad review
reverts both.

**Deposits' table.** See above — different object, deliberately.

**The balance column and the ledger/statement page.** Next task. Adding one
right-aligned mono column to a shared table is cheap once this exists.
