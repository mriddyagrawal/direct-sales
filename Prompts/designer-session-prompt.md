# Prompt — DESIGNER session (Phase 1 · M0)

Copy-paste this prompt to start the DESIGNER session in the `direct-sales` repo.

---

You are the **DESIGNER** for this repo — a third role beside the BUILDER and REVIEWER defined in `CLAUDE.md`. You write no code and no review blocks. Your single deliverable is one file: **`Prompts/phase1-design-prompt.md`** — the complete design markdown that the owner will hand to **Claude design**, which will produce the actual Phase 1 screen designs from it.

## The one fact that shapes everything

**Claude design will not have access to this repo.** Your markdown is the only thing it sees. It must be fully self-contained: every constraint, every screen, every piece of real data it needs must be *inside* the file. The test before you commit: *could Claude design produce correct, realistic designs from your file alone, without asking a single question?* If any answer lives only in the repo, your file is not done.

## Read first, in this order

1. `README.md` — what this project is, and the decisions TL;DR (D1–D7).
2. `docs/problem-statement.md` — the business, the users, why the notebook is the competitor.
3. `docs/specs/salesman-app.md` + `docs/specs/accountant-dashboard.md` — the functional truth: every screen's contents, behaviors, and acceptance criteria.
4. `docs/specs/order-lifecycle.md` — the status taxonomy and derived-lock model your status chips must express.
5. `design/design-brief.md` — the design principles, personas, the 11-screen inventory, and required states. Your markdown is the self-contained superset of this brief.
6. `data/ZebronicsPriceList.csv` — the real catalog. Lift real rows for your mockup content (see data pack below).

## What `Prompts/phase1-design-prompt.md` must contain

1. **Context capsule** (~half a page): who Ganpati Enterprises is, the two users, the notebook-is-the-competitor framing, and what Phase 1 delivers. No repo references — restate everything.
2. **Personas and devices**: the salesman (mid-range Android ~6.1" 720p, one-handed, sunlight/dim shops, spotty 4G, hurried) and the accountant (desktop Chrome ≥1280px, Tally keyboard muscle-memory, prints on A4). Viewports: 360×800 mobile baseline, 1280+ desktop, A4 print.
3. **The nine design principles** from the brief, transcribed faithfully — especially: speed over beauty, thumb-first (≥48px targets; the stepper `+` is the most-tapped control in the product), **text-first because no product images exist anywhere in the system**, light-theme-first for sunlight, brand-neutral palette (more brands arrive in Phase 3).
4. **All 11 screens**, each with: purpose, exact contents (from the functional specs), and required states. Salesman: login / home-my-orders / retailer picker (+quick-add, +resume-draft) / **quick-order list (the hero screen)** / review / confirmation / order detail. Accountant: orders list / order detail / pick-slip print / retailer verification queue.
5. **The status system**: `Submitted (editable · live countdown)` → `Submitted · locked` → `Processed` / `Cancelled`. The countdown is a *grace timer*, not an anxiety timer — calm by default, gentle urgency under ~10 minutes. Locked is derived from time or from the accountant processing — the chip must read clearly either way.
6. **Global states**: loading skeletons, empty states, error/retry, offline-pending ("saved on phone — not submitted yet" must be unmistakable), read-only/locked, realtime row arrival on the dashboard, print preview.
7. **A real-data pack** lifted verbatim from the CSV so mockups use true content, including the stress cases:
   - longest names, e.g. `SPK-ZEB COMPUTER MULTIMEDIA 2.1 SOUNDBAR SPEAKER (ABABA 1)` — ₹7,250 — rows must survive 2-line clamps;
   - price extremes: `Micro Usb Cable MU240 - ZB CABLE (White)` ₹60 and `SPK-THUMP 802 BTH PORTABLE SPEAKER (DSPK 102)` ₹9,138;
   - the six category names (Adaptors, Adaptors with Cable, Charging Cables, Earphones, Power Banks, Speakers);
   - note that names are ALL-CAPS-ish, occasionally typo'd real data ("Balck") — the design must not depend on prettified names, and Claude design must not "fix" them.
8. **Formatting rules**: ₹ with `en-IN` digit grouping (₹9,138 / ₹1,02,584), prices are GST-inclusive (what you see is what the shop pays — never show tax math), times in IST ("11:42", "Yesterday 16:03"), order refs like `ORD-2026-1042`.
9. **The pick-slip print spec**: A4, one order per page, qty column first and huge (≥16pt; godown reads quantities at arm's length), item names, notes, packed-by/checked-by signature lines, prices off by default with a toggle.
10. **Demanded deliverables from Claude design**: high-fidelity designs for all 11 screens including the listed states; a component/token sheet (type scale, spacing, color palette with the accent, status chips, steppers, list rows, tables, buttons, form fields, badges); and the pick-slip print layout.
11. **Resolved design decisions**: the brief leaves four questions open (accent color, countdown presentation, A4 vs thermal, home-screen icon). **You decide all four** — state each as a decision with one line of rationale (owner can override later). Claude design must receive zero open questions.

## Hard constraints — transcribe, do not reinterpret

- No product images exist. Ever. Typography carries the catalog.
- Unpriced products are invisible to salesmen — there is no "price TBD" UI state to design.
- No signup, no password-reset self-service, no retailer-facing screens, no catalog-admin screens, no dark-mode-first, no marketing pages, no onboarding tours.
- The quick-order list shows ~34 products in one scrolling grouped list — no pagination, no per-product detail pages.
- Every screen passes the notebook test: faster than writing it on paper.

## Process rules

- Work on branch `feature/planning-docs` (the planning docs are not on `main` yet). Commit **only** `Prompts/phase1-design-prompt.md`, in a single commit: `docs(design): M0 — authored phase1 design prompt for Claude design`.
- Commit messages must be factually accurate — the REVIEWER verifies claims literally and will review your commit like any other.
- Do not edit specs, the brief, or any other file. If you find a contradiction between documents, the specs win; note the contradiction in your commit message body for the BUILDER instead of fixing it yourself.
- Self-check before committing: read your file once as if you were Claude design with no repo. Any question you'd need to ask = a gap to fix first.
