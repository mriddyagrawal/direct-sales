# BUILDER prompt — the import wizard prefixes LG tally names

Owner-approved 2026-08-08. **One file of logic + one helper. No DB work.**

LG's Tally items are named `LG <model>`. LG's *price lists* give the bare model
number. So today an LG price list matches nothing in the catalog, and the owner
has to add a CONCATENATE column in Excel before every import. This removes that.

There is no separate spec file — the change is small enough that this prompt is
the spec. Everything below is settled.

---

## How this run works

**This page is live and LG has 612 products in it.** Work on a branch, **do not
push**, and after every commit:

1. Commit. **Do not push. Do not merge to `main`.**
2. `npm run dev`, leave it running.
3. Say what changed and what to look at.
4. **Stop and wait.**

`npx tsc --noEmit` and `npx eslint src` clean before each commit. Commit messages
must be factually accurate — the REVIEWER verifies claims against the diff and
against prod, and has caught several this month that described changes absent
from their own commit.

---

## The rule

```js
// brand is LG, applied to the TALLY NAME only
if (!tally.startsWith("LG ")) tally = "LG " + tally;
```

**Case-sensitive `startsWith`. No case folding. No trimming beyond what `cell()`
already does. No inference. No smarts.**

What it produces — these are the acceptance tests:

| sheet cell | becomes | expected result |
|---|---|---|
| `GL-B257JPZ3` | `LG GL-B257JPZ3` | Updated |
| `LG GL-B257JPZ3` | unchanged | Updated — idempotent |
| `gl-b257jpz3` | `LG gl-b257jpz3` | **New product — CORRECT, not a bug** |
| `lg GL-B257JPZ3` | `LG lg GL-B257JPZ3` | **New product — CORRECT, not a bug** |
| `GL-B257JPZ3 ` | `LG GL-B257JPZ3` | Updated (`cell()` already trims) |
| `ZEB-SPK-X1` (Zebronics) | unchanged | no prefix on non-LG brands |

---

## Where it goes

**1. The helper lives in `src/lib/catalog.ts`**, beside `effectiveTallyName` —
that file is already the home of the tally-name rules and is already shared by
the import and the Add/Edit modal.

Keyed on brand **name**, with a table rather than an `if`, so brand #2 is a
one-line change. Record the invariant in the comment: verified 2026-08-08,
**612/612 LG products are exactly `LG ` + model — uppercase, single space, zero
exceptions.** Also record that keying on the name means renaming the brand would
silently disable the rule; that is the accepted cost of not touching the DB.

An empty tally name must return unchanged, never `"LG "`.

**2. Apply it in `ImportWizard.tsx` at line 121** — the current line is:

```ts
const effTally = effectiveTallyName(rawTally, rawName); // match key: tally ← display
```

The prefix goes on **`effTally`, AFTER `effectiveTallyName` resolves the
tally←display fallback.** Not on `rawTally` before it.

**This is deliberate and the owner chose it explicitly.** A sheet whose only
name column is labelled "Display Name" still flows through the fallback, and at
that point the resolved value *is* the tally name, so it must be prefixed too.
Prefixing `rawTally` instead would silently skip that sheet shape.

**3. Do not touch line 142.**

```ts
const name = rawName || (matched ? ex!.name : rawTally);
```

That reads `rawTally` — the **unprefixed** value — and that is exactly right.
**The display name never gets the prefix** (owner 2026-08-08). A new LG product
imported from a bare model list gets display name `GL-B257JPZ3` and tally name
`LG GL-B257JPZ3`.

**4. Resolve the brand name properly.** Do **not** reuse `brandName` from line
61 — it carries a `?? "products"` fallback that exists for the template
filename. Resolve the brand inside `handleFile` from `brands.find(...)`.

**5. Say it in the hint text** when the selected brand has a prefix: something
like *"Tally names will be prefixed with `LG `."* The preview does show the
resolved tally name, but the admin should know **why** the names changed rather
than having to infer it. Small, but this rule rewrites the match key and an
invisible rule that rewrites a key is how you get a bad import at 9pm.

---

## Settled — do not re-open

**Do NOT make the matching case-insensitive.** You will be tempted: the wizard
matches with `existingByTally.get(effTally)`, an exact case-sensitive `Map.get`,
and `products_brand_tally_key` is `UNIQUE (brand_id, tally_name)` on the raw
column — so `LG GL-B257JPZ3` and `LG gl-b257jpz3` are two different products and
a mis-cased sheet will create duplicates.

**The owner considered this and chose it, with reasons that are good.** On a
*key*, refusing to merge is the safe failure direction: a duplicate is visible in
the preview as a New row, and is deletable. A wrong case-fold silently
overwrites a real product's price and leaves no trace that it happened.

So a case mismatch producing New rows is **correct behaviour**. Do not "fix" it,
and do not add a `lower()` anywhere in this path.

**Do not add a migration.** The case-sensitive unique index is the reason case
variants create rows, and it stays. If you think you need a DB change, stop and
ask the owner — everything here is prod.

**Do not touch the stock importer.** It matches on `lower(btrim(tally_name))`
and that asymmetry with this wizard is now deliberate and documented.

---

## Traps this project has already paid for

**A scripted find-and-replace that no-ops looks exactly like one that worked.**
It has happened twice here, once shipping a commit message describing a change
absent from its own diff. After a scripted edit, read the target back.

**`fileTallies.add(effTally)` at line 124 and the `untouched` count at line 158
both key off `effTally`** — so they pick up the prefixed value automatically,
which is correct. Check that the untouched count still reads sensibly on an LG
import; it is the line that tells the owner nothing was silently dropped.

**The payload at line 172 sends `tally_name: r.tallyName`** — the prefixed
value. That is what must reach the RPC. `import_products` is unchanged.

**Money is paise** and untouched by this work — but do not let a refactor near
`parsePricePaise` change price handling.

**Verify by execution, not by reading.** A node harness over the real
`catalog.ts` helpers covering all six table rows is the minimum; the REVIEWER
will run the same cases and will check the two "New product" rows produce New,
not a silent merge.

---

## Constraints

- **LG is live: 612 products, 577 priced, salesman-visible.** The preview is the
  only thing between a bad sheet and the catalog — do not weaken it, and do not
  add an auto-apply path.
- **Non-LG brands must be provably unchanged.** Zebronics, Luminous, Bajaj,
  Sargam, EOL and Other all import exactly as they do today. Prove it, don't
  assume it.
- `tsc --noEmit` and `eslint src` clean before every commit.
