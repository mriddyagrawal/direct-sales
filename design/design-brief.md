# Design Brief — Phase 1 (for the Claude design session)

You are designing **Phase 1 of a B2B field-sales order app** for Ganpati Enterprises, a small Indian electronics distributor. Two interfaces: a mobile web app a salesman uses *inside retail shops*, and a desktop dashboard for the company's accountant.

**Your working order:**
1. Read [README.md](../README.md) → [docs/problem-statement.md](../docs/problem-statement.md) → [docs/specs/salesman-app.md](../docs/specs/salesman-app.md) → [docs/specs/accountant-dashboard.md](../docs/specs/accountant-dashboard.md) → this brief. The specs define *what exists on each screen*; this brief defines *how it should feel*.
2. Write the complete design markdown to **`Prompts/phase1-design-prompt.md`** (the owner's workflow: you author the definitive prompt after reading the repo; kickoff instructions live in `Prompts/designer-session-prompt.md`).
3. The designs themselves are produced by **Claude design** from that file — and Claude design has **no repo access**, so your markdown must be fully self-contained (all constraints, screens, and real data embedded).

## The one-line brief

**The competitor is a paper notebook.** A salesman standing in a noisy shop, phone in one hand, shopkeeper dictating — every design choice is judged by "is this faster than writing it down?"

## Users

- **Raju, field salesman.** Mid-range Android (~₹10k, ~6.1" 720p), Chrome. One-handed use; bright daylight outside, dim shops inside; spotty 4G; in a hurry, always. Fluent with WhatsApp-class apps, not "web apps". English UI is fine; product names come verbatim from the catalog (long, ALL-CAPS-ish, occasionally typo'd — that's real data, design for it).
- **The accountant.** Desktop Chrome at the office, all day inside Tally (a keyboard-first DOS-lineage ERP). Wants density, legibility, zero ceremony. Prints paper for the godown.
- **The owner.** Glances at the dashboard; needs status readable at a glance.

## Non-negotiable principles

1. **Speed over beauty** — but calm, confident utility, not ugliness. A tool, not a consumer app.
2. **Thumb-first mobile**: primary actions in bottom reach; the stepper **[+]** is the most-tapped control in the product — ≥48px target.
3. **Text-first**: there are **no product images** in the system. Typography carries everything: product name (2-line clamp), price, quantity.
4. **Dense but legible**: ~34 products in one scrolling grouped list is the core screen. Compact rows that remain unmistakably tappable.
5. **Numbers are the content**: prices as ₹ en-IN (`₹9,138`), GST-inclusive (what you see is what the shop pays); totals always visible (sticky cart bar); quantities huge on print.
6. **One status system across both apps**: `Submitted (editable · countdown)` / `Submitted · locked` / `Processed` / `Cancelled` — consistent chips and colors. The countdown is a *grace timer*, not an anxiety timer: helpful, not alarming, with a gentle urgency shift under ~10 minutes.
7. **Visible sync truth**: saved-locally / submitting / submitted / retry states must be unmistakable — a salesman in a dead zone must *know* his order is safe (or not yet sent).
8. **Light theme first** (sunlight readability, high contrast). Dark optional.
9. **Brand-neutral palette + one confident accent**: the app must not look Zebronics-branded — more brands arrive in Phase 3.

## Screens (11)

**Salesman — mobile, 360×800 baseline:**
1. **Login** (email/password, remember-me; error states).
2. **Home / My Orders** — "New Order" primary; order cards with ref, retailer, total, status chip, countdown; Today vs earlier; empty state.
3. **Retailer picker** — instant search, recents first, quick-add form (name/area/phone), "continue draft?" resume prompt.
4. **Quick Order list — the hero screen.** Category-grouped dense list, sticky instant search, rows = name + price + stepper (tap qty → numeric keypad), qty>0 rows visibly "in cart", sticky cart bar (`3 items · ₹2,584 — Review ▸`). Design searching / filtered / empty-results states.
5. **Review** — editable lines, notes field, retailer header, total, Submit.
6. **Confirmation** — big order ref, "editable until HH:MM", back to Home.
7. **Order detail** — snapshot lines, humanized event timeline, countdown; Edit/Cancel while editable; locked read-only state ("call the accountant…").

**Accountant — desktop, 1280+:**
8. **Orders list** — live table (new rows highlight in), filters (status/salesman/date), search, NEW-retailer badge.
9. **Order detail** — lines, notes, event timeline, actions: Mark processed (the lock), Edit (reason modal after lock), Cancel (reason), Print.
10. **Pick slip (print)** — A4 print CSS: qty column first and huge, item names, notes, signature lines; prices off by default (toggle for a priced order copy). Must be legible at arm's length in a godown.
11. **Retailer verification queue** (`/dashboard/retailers`) — design as a variant of the orders-table pattern: list with verified/unverified filter, NEW badges, inline edit of name/area/phone (canonical spellings feed the Phase 2 Tally mapping), mark-verified action.

## States to design deliberately

Loading skeletons · empty states · error/retry · offline-pending · locked/read-only · countdown urgency (<10m) · realtime row arrival · print preview.

## Out of scope

Marketing pages, onboarding tours, retailer-facing UI, catalog-admin screens (Supabase Studio covers it), animation beyond functional feedback, dark-mode-first.

## Deliverables

1. Yours (the DESIGNER session): `Prompts/phase1-design-prompt.md` — the complete, self-contained design markdown.
2. Claude design's (your markdown must demand these): designs for the 11 screens including the listed states; component tokens (type scale, spacing, status chips, steppers, table/list rows, buttons, form fields — enough for a builder to implement without guessing); and the pick-slip print stylesheet spec.

## Design decisions to resolve (state your recommendation as the decision)

Accent color · countdown presentation · A4 vs thermal slip layout · add-to-home-screen icon. Decide all four in your markdown — Claude design must receive zero open questions; the owner can override later.
