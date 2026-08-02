# PARKED DECISION — hiding balances on salesman screens

Owner parked this 2026-08-02 to be formalised by the planner/reviewer. **This is
not a spec yet.** It records the problem, what already shipped, the two options,
and the reasoning, so the decision can be made from the argument rather than
re-derived.

Written by the BUILDER at the owner's request. It is deliberately NOT a numbered
review flag — numbering is the REVIEWER's.

---

## The problem, in the owner's words

The salesman opens the app **standing in front of the shopkeeper**. A list full
of red outstanding amounts reads to that shopkeeper as *"this man has so much
money to collect from the market"*, which starts a conversation nobody wants —
and more directly, **shopkeepers should generally not know the amounts** owed by
other shops.

The leak is specific: it is the LIST surfaces that expose OTHER shops' balances.

| surface | what a shoulder-surfer sees | leak? |
|---|---|---|
| Quick Order retailer picker | every shop's balance | **yes** |
| Salesman Retailers tab | every shop's balance | **yes** |
| Quick Order ribbon | only THIS shop's balance | no — it is their own |
| Order detail hero | only THIS shop's balance | no — it is their own |
| Office retailers queue | every shop's balance | no customer present |

## What already shipped (da74a48)

Owed reads **blue** instead of red on the two salesman LIST surfaces and on the
Quick Order ribbon. Green (nothing to chase) is unchanged everywhere, and the
office queue keeps red.

**Blue removes the impression, not the information.** Every figure is still
rendered and still legible to anyone who looks. If the requirement is that a
shopkeeper cannot READ the amounts, blue does not deliver it.

## The two options on the table

**A — per-row eye glyph** (the owner's sketch). Each row carries a reveal
control; tapping it shows that row's amount. Tapping does not navigate.

**B — one masking toggle in the header** (the builder's counter-proposal). All
amounts render as `••••••` until the screen's single toggle is flipped, the way
a banking app hides a balance.

## The builder's recommendation, and why

**B, and keep the blue.** They are not competing: blue handles "amounts are
visible and someone glances over", the mask handles "make them genuinely
private".

Three arguments against the per-row version specifically:

1. **It reveals in front of the wrong person.** The tap happens while the
   shopkeeper is watching, so the number is uncovered in front of exactly the
   person it is hidden from. A single toggle is flipped BEFORE walking in.
2. **599 rows means 599 controls** on a list whose whole job is scanning names —
   `PickRetailer.module.css` says it outright: *"the names are the scan target"*.
3. **Per-row state is per-row work.** One toggle is one boolean.

## Things to settle when this is formalised

- **Does the mask persist?** Across screens, across sessions, or reset each
  open? A mask that resets to VISIBLE on every launch protects nobody who
  forgets; one that persists hidden may annoy the office user who shares the
  build.
- **Exempt the ribbon and order detail?** Both show only the shop being served,
  which that shopkeeper is entitled to know. Masking them costs privacy nothing
  and costs the salesman a tap.
- **Does the office queue mask at all?** Recommendation: no. No customer is
  present, and it is the screen you open specifically to read balances.
- **What does a masked row show?** `••••••` keeps the column width honest;
  blanking it makes the row look broken.
- **Is blue still wanted once masking exists?** Yes, per the above — but it
  should be a conscious answer, not an accident of ordering.
