# BUILDER task — Tally ledger link + duplicate-name guard on the retailer cards

Owner-requested 2026-08-01, after the ledger sync went live. **No DB work is
needed — every migration below is already applied to prod.** This is app-side only.

---

## Why this exists

The nightly Tally sync writes each shop's outstanding balance and statement into
the app. It finds the shop by matching `retailers.tally_ledger_name` against the
ledger name in the Tally export.

**As of tonight, `_apply_ledger` matches on `tally_ledger_name` ONLY.** The old
fallback to `retailers.name` was removed at the owner's instruction: the shop's
display name is for humans and gets edited, so letting it silently carry the
ledger link means a rename can re-point real money at the wrong shop.

The consequence, and the reason for this task: **a shop with no
`tally_ledger_name` syncs nothing, forever, and there is currently no screen
anywhere in the app to set it.** 591 of 598 active shops were backfilled by hand
tonight. Every shop added from now on starts unlinked.

---

## What already exists in prod (do not re-create)

| Object | State |
|---|---|
| `retailers.tally_ledger_name` | `text null` — populated on 591 of 598 active shops |
| `retailers.outstanding_paise` | `bigint null` — POSITIVE means the shop owes us |
| `retailers.balance_as_of` | `timestamptz null` |
| `retailers_name_norm_unique` | unique index, **all rows**, on the normalised name |
| `retailers_tally_ledger_name_norm_unique` | unique index, **partial** (where set), on the normalised Tally name |
| `_apply_ledger` | matches on `tally_ledger_name` only — no fallback |

Both indexes normalise identically:

```sql
lower(regexp_replace(btrim(<col>), '\s+', ' ', 'g'))
```

**Any client-side check MUST mirror that exactly** or the form will pass a name
the database then rejects:

```ts
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
```

`src/lib/types/database.types.ts` already has `tally_ledger_name` but is missing
`outstanding_paise` and `balance_as_of` — **regenerate it** as step one.

---

## Task 1 — a Tally ledger name field on both cards

Two surfaces, deliberately different in tone.

**A. Office — `src/app/dashboard/retailers/RetailerModal.tsx`**

Full field, sits after Phone. This is the screen that actually fixes links, so
it carries the real explanation.

**B. Salesman quick-add — `src/app/new-order/PickRetailer.tsx` (`showQuickAdd`)**

Optional and visually secondary. A salesman in the field does not know Tally
ledger names and must never be blocked by this — it is there for the rare case
where they do know, not a step in the flow.

### The rule that makes "leave it blank" work

> **When the field is left blank, write `tally_ledger_name = name.trim()`.
> Never write `null`.**

This is the whole point. The owner asked that the two "be the same if not
added", and since the matcher has no fallback, *the form* has to store it.
Inferring it at match time is exactly what we just removed.

Consequences to honour:

- On **create**, blank → store the shop name.
- On **edit**, if the row's `tally_ledger_name` is already set and the user
  renames the shop, **leave `tally_ledger_name` alone.** That is the rename
  safety the whole change was for. Say so in the UI rather than silently doing it.
- On **edit**, if `tally_ledger_name` is somehow empty and the user saves,
  backfill it from the name, same as create.

### Copy

Write it in the app's voice; these are the meanings, not mandated strings.

- Label: `Tally ledger name`
- Helper, office: leave blank and the shop name is used. This is what the
  nightly sync matches on.
- Helper, office, **only when the row already has a link and the name field has
  been edited**: renaming the shop will not change this — the sync keeps using
  the Tally name.
- Salesman: mark it optional, one short line that blank means the shop name.

Do **not** use the word "mapping". `RetailerModal.tsx:84` currently reads
*"this exact name becomes the Tally ledger mapping in Phase 2"* — that is now
stale (Phase 2 shipped, and it is no longer automatic). Replace it.

---

## Task 2 — flag a duplicate before it is created

Two layers, both required. The live check is the good experience; the error
mapping is the one that is actually correct.

### Layer 1 — live, while typing

`PickRetailer` already holds the full retailer list in props, and `RetailerModal`
can read the same rows from the cached `["retailers"]` query (`RetailersQueue`
already populates it). Compare with `norm()` above, excluding the row being
edited by `id`.

On a hit, in the **salesman** flow, do better than a warning — the salesman
searched, missed it, and is about to duplicate a shop. Show the existing shop
(name + area) and give them a button to **use that shop instead**, which calls
the same `onSelect` path as picking it from the list. Preventing the duplicate
by making the right action one tap away beats blocking.

In the **office** modal, a plain inline warning naming the other shop is enough.

### Layer 2 — the database error

The live check can miss: the cached list may exclude inactive shops or rows RLS
hides, and two people can submit at once. So the `23505` path must be handled
regardless, and mapped to something human. The constraint name appears in the
Postgres message:

| Constraint in the message | Means |
|---|---|
| `retailers_name_norm_unique` | another shop already has this name |
| `retailers_tally_ledger_name_norm_unique` | another shop is already linked to that Tally ledger |

Anything else: keep showing the raw message, as today. Do not swallow unknown errors.

Put both the `norm()` helper and the error mapper in one shared module — both
cards need them and they must not drift.

---

## Files

- `src/lib/types/database.types.ts` — regenerate first
- `src/lib/queries/retailers.ts` — add `tally_ledger_name` to `RetailerRow` and
  the `select`. It is the shared superset feeding both surfaces, so both cards
  get it from one change.
- `src/app/dashboard/retailers/RetailerModal.tsx`
- `src/app/new-order/PickRetailer.tsx`
- new: shared `norm()` + save-error mapper

---

## Constraints

- **Prod.** Branch off `main`. No DB changes are required by this task — if you
  think you need one, stop and ask the owner first.
- Small atomic commits, accurate messages (the REVIEWER verifies claims literally).
- Money is stored in **paise**; if any of this work renders a balance, convert to
  rupees and format `en-IN`. Do not render raw paise.
- **Think about the phone.** A desktop change usually has a phone counterpart —
  work out what it is, decide deliberately, and say what you decided. No negative
  side effects: nothing on the phone should degrade because a desktop edit did
  not consider it. A phone bug is a bug and gets fixed. The one settled piece is
  the **Orders** phone layout (sticky chips, tuned padding) — do not redesign it.
- RLS is row-level, not column-level: a salesman who can insert a retailer can
  set `tally_ledger_name` on it. No policy change needed.

## Out of scope

Everything that shows a balance to a user — picker rows, retailers list column,
order-detail band, the ledger/statement page. Those are the next task, and they
have their own rule: `outstanding_paise IS NULL` must read **"not in the last
sync"**, never ₹0.
