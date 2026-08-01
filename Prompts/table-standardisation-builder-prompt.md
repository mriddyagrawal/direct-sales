# BUILDER prompt — table standardisation, retailer detail route, FAB consolidation

Read **`docs/specs/table-standardization-and-retailer-detail.md`** and implement it.
That file is the spec; this is how to work.

---

## How this run works — read this before writing anything

**The product is live and in use.** Everything happens on **one branch**, and
**nothing is pushed** until the owner has signed off the whole run.

After **every single commit**:

1. Commit to the branch. **Do not push. Do not merge to `main`.**
2. Start the app: `npm run dev`. Leave it running.
3. Tell the owner it is up, and say — briefly and specifically — **what changed
   and what to look at**: which pages, which surface, phone width or desktop.
   "Step 2 done, Users page migrated, look at the desktop table header alignment"
   beats "done".
4. **Stop and wait.** The owner clicks through and comes back with how it feels.
5. Only then start the next step.

Do not batch steps. Do not run ahead while waiting. The whole value of this shape
is that a bad call gets caught on the step that caused it, not five steps later.

**Before each commit:** `npx tsc --noEmit` and `npx eslint src` must both be clean.
Lint is a real signal on this project — it was just repaired for exactly this
reason, so do not let it go noisy again.

**Commit messages must be factually accurate.** The REVIEWER verifies claims
literally and flags drift. If a commit unifies values but leaves four copies, the
message says that — do not write "one X, four pages" for something that is still
four things.

---

## The seven steps, in order

1. Create `src/components/ui/table.module.css` + the `--text-table-head-tracking`
   token. Nothing imports it yet.
2. Migrate **Users** — this also fixes its 12px header misalignment.
3. Migrate **Products**.
4. Migrate **ImportWizard**.
5. Migrate **Orders** — styles only. Do **not** touch its prefetch or
   `.rowSelected` logic.
6. **Retailers**: desktop table + keep the phone cards + `/dashboard/retailers/[id]`
   detail route, with edit moving there from the modal.
7. **Consolidate the FAB** into `src/components/ui/fab.module.css`. Last, because
   nothing in it is user-visible — the FAB *bug* is already fixed.

---

## Five things in the spec are conclusions from measurement, not preferences

Do not re-lit­igate these; they were each settled by running something.

**`--text-table-head-tracking: 0.06em` is a NEW token.** Do not reuse
`--text-section-label-tracking` (0.08em) — it is used in ~21 places, all section
labels in forms and flows, never a dense table header. Adopting it would visibly
loosen four table headers for no benefit.

**Do NOT copy Orders' desktop `<tr onClick={router.push}>` pattern.** Its
`onMouseEnter` sets React state, re-rendering the whole unmemoized row list on
every row the cursor crosses — that is the visible hover trail on the Orders page
in production — and it loses middle-click, open-in-new-tab and link semantics.
Retailers' rows use a real `<a>` in the name cell, stretched over the row.

**The phone cards use a real `<Link>`**, like Orders' cards. That is the half of
Orders worth copying.

**`tally_ledger_name` is editor-only.** A normal labelled field on the detail page
and the quick-add; **nothing** in the retailers list — no column, no second line
under the name. Measured 596 of 599 identical to `name`.

**Ship the stub detail page in step 6, not later.** Without it the links point at
a 404 and nobody can test the step.

---

## Constraints

- **No DB work anywhere in this task.** Every column it reads already shipped
  (`outstanding_paise`, `balance_as_of`, `tally_ledger_name`). If you think you
  need a migration, stop and ask the owner.
- Money is stored in **paise**. Nothing in this task renders an amount, but if
  that changes: convert to rupees and format `en-IN`, never show raw paise.
- **Think about the phone.** A desktop change usually has a phone counterpart —
  work out what it is, decide deliberately, and say what you decided. No negative
  side effects: nothing on the phone should degrade because a desktop edit did
  not consider it. A phone bug is a bug and gets fixed. The one settled piece is
  the **Orders** phone layout (sticky chips, tuned padding) — do not redesign it.
- Deposits' table is **out of scope** — it is a deliberately different object.

## One thing that will look wrong on localhost and is not

Next's route prefetching is a **no-op in dev**. The Orders desktop hover trail
will not reproduce on localhost. That is expected, it is pre-existing production
behaviour, and nothing in this task should be judged by its absence there.
