# Ganpati Enterprises — Direct Sales

A B2B order-capture app for a small distribution business: field salesmen punch retailer orders on their phones; the accountant sees them instantly on a desktop dashboard and books them into Tally. The app is a **capture tool, not an ERP** — Tally remains the statutory system of record for invoices, stock, and GST.

**Status:** Planning complete. Next step: **design phase** (see [design/design-brief.md](design/design-brief.md)), then Phase 1 implementation per [PLAN.md](PLAN.md).

## The one-paragraph pitch

Today a salesman writes orders in a notebook, the accountant deciphers and re-types them into Tally, the godown picks from the printed invoice, and payment is collected on a later visit. Illegible handwriting, lost slips, hours of latency, and zero visibility. Phase 1 replaces the notebook with a mobile "Quick Order" screen and gives the accountant a live dashboard; later phases remove the Tally re-typing (XML import), add more brands, surface outstanding balances, and add controlled price negotiation.

## Repo map

| Path | What it is |
|---|---|
| [README.md](README.md) | You are here — orientation and reading order |
| [PLAN.md](PLAN.md) | Phased roadmap with milestones, acceptance criteria, and open questions |
| [docs/problem-statement.md](docs/problem-statement.md) | The business, the current workflow, the pain, success criteria |
| [docs/architecture.md](docs/architecture.md) | Stack, system design, principles, ops/cost reality |
| [docs/decisions.md](docs/decisions.md) | Decision log (D1–D7) + graveyard of rejected ideas |
| [docs/specs/](docs/specs/) | Engineering specs — the source of truth for implementation |
| [docs/specs/data-model.md](docs/specs/data-model.md) | Tables, fields, constraints, sequence, triggers |
| [docs/specs/order-lifecycle.md](docs/specs/order-lifecycle.md) | Order state machine, edit window, numbering, audit events |
| [docs/specs/roles-and-permissions.md](docs/specs/roles-and-permissions.md) | Roles, auth provisioning, full RLS matrix, enforcement |
| [docs/specs/salesman-app.md](docs/specs/salesman-app.md) | Functional spec — mobile salesman flow |
| [docs/specs/accountant-dashboard.md](docs/specs/accountant-dashboard.md) | Functional spec — desktop dashboard + printable pick slip |
| [docs/specs/seed-data.md](docs/specs/seed-data.md) | CSV → database seeding rules and verification |
| [design/design-brief.md](design/design-brief.md) | Input for the design phase (Claude design reads the repo, then this) |
| [Prompts/](Prompts/) | Destination for designer-authored prompts |
| [data/ZebronicsPriceList.csv](data/ZebronicsPriceList.csv) | Source price list (42 SKUs; 8 unpriced "TBD") — never hand-edited |
| [comments.md](comments.md) | TESTER's commit-review log (see workflow below) |
| [archive/](archive/) | Original AI-drafted planning docs + conversation export, kept for history |

## Key decisions (TL;DR — full context in [docs/decisions.md](docs/decisions.md))

1. **D1** Order numbers are internal refs from a plain Postgres sequence; gaps are acceptable. Tally owns statutory invoice numbers.
2. **D2** Unpriced ("TBD") products are hidden from salesmen until priced (`price_paise IS NULL`).
3. **D3** Supabase Auth with admin-created email+password accounts; roles via `profiles`.
4. **D4** Brands are sold on separate visit rounds → Zebronics-only Phase 1 is safe; multi-brand is Phase 3.
5. **D5** CSV prices are GST-inclusive retailer billing rates → app totals equal invoice totals; no tax math in-app.
6. **D6** Design target: 1–2 salesmen, <20 orders/day — optimize for field speed, not scale.
7. **D7** Deliberate custom build over off-the-shelf DMS SaaS.

## Reading order

- **Engineers / builder session**: problem-statement → architecture → decisions → all of `docs/specs/` → PLAN.md.
- **Designer session**: README → problem-statement → salesman-app + accountant-dashboard specs → **design/design-brief.md** (your instructions live there).
- **Reviewer / TESTER session**: everything above, plus note that the specs **supersede** the standing checklist in `comments.md` where they diverge — specifically: gaps in order numbers are by design (D1, not a defect), and "LOCKED" is a *derived condition*, not a stored status (see [order-lifecycle.md](docs/specs/order-lifecycle.md)).

## Working agreement

- **Spec-first**: `docs/specs/` is authoritative. If implementation must deviate, update the spec in the same commit and say why.
- **Builder/tester split**: the BUILDER commits code; a separate TESTER session reviews every commit in [comments.md](comments.md) by actually running things. Blocking findings are fixed in the very next commit.
- **Stack**: Next.js (App Router) on Vercel + Supabase (Postgres, Auth, RLS, Realtime). Money is always integer **paise**. Details in [docs/architecture.md](docs/architecture.md).
