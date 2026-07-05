# Problem Statement — Ganpati Enterprises Direct Sales

## 1. Business context (the numbers that matter)

Ganpati Enterprises is a small B2B distributor of consumer electronics accessories, supplying retail shops in its territory. Facts that shape every design decision in this project:

- **Brands**: distributes several brands; **Zebronics** is the first in scope. Each brand is sold on a **separate visit round** — a Zebronics round only collects Zebronics orders (confirmed 2026-07-06, decision D4).
- **Catalog**: ~42 Zebronics SKUs across 6 categories (adaptors, adaptors with cable, charging cables, earphones, power banks, speakers). 34 have confirmed prices; 8 are marked "TBD" pending rate confirmation. Source: [data/ZebronicsPriceList.csv](../data/ZebronicsPriceList.csv).
- **Prices**: the price list holds the **actual retailer billing rate, GST-inclusive** (₹60 for a micro-USB cable up to ₹9,138 for a party speaker). The number on the list is the number on the invoice (D5).
- **Team**: **1–2 field salesmen**, **one accountant**, godown (warehouse) staff, and the owner.
- **Volume**: **under 20 orders/day** across the team; a typical order is a handful of line items.
- **System of record**: **Tally** — all statutory invoicing, GST, ledgers, and stock live there and will continue to.
- **Credit cycle**: goods are delivered now; the salesman collects payment on a later visit. Outstanding balances are tracked in Tally.

This is a small-scale, high-trust operation. The system serving it must optimize for **speed in the field and zero training overhead** — not for enterprise concurrency, multi-tenancy, or scale that will never arrive.

## 2. The current workflow, end to end

Five legs, four humans, three paper handoffs:

1. **Order capture** — the salesman stands in a retailer's shop and writes the order in a notebook while the shopkeeper rattles off items ("10 of the small cables, 5 adaptors, 2 Astra speakers…").
2. **Handoff** — at the end of the route (hours later), the salesman hands the pages to the accountant, or dictates over the phone.
3. **Invoicing** — the accountant deciphers the handwriting, matches scribbles to actual SKU names (the catalog is full of near-identical entries like "TT27 PLUS" vs "TT65"), and types the order into Tally to produce a GST invoice.
4. **Fulfillment** — a printed invoice copy goes to the godown; staff pick, pack, and deliver to the shop.
5. **Collection** — on a later visit, the salesman collects payment against the outstanding balance.

## 3. Pain points

**A. Illegibility and lost information.** Handwriting is misread, lines are skipped, slips are lost or rained on. Product names on the price list are long and near-identical; "TT-something cable, red" can be two different SKUs at two different prices.

**B. Latency.** An order taken at 11am physically reaches the accountant in the evening. The godown is idle all day, then slammed. Delivery slips a day, retailers call to chase.

**C. Double entry.** The same order is written twice — notebook, then Tally. Every transcription is an error opportunity. *Honest framing:* Phase 1 of this project kills the notebook leg (capture is structured at the source); the accountant still types into Tally until Phase 2 delivers XML import. Phase 1's wins are legibility, latency, and visibility — not yet single entry.

**D. Zero visibility.** The owner can't see today's sales until evening. The salesman gets no confirmation that his order was billed. When a shop disputes what it ordered ("I said 5, not 50"), it's one person's notebook against another's memory.

**E. Price staleness.** Price revisions travel by memory and photocopies. Today's list literally has 8 SKUs marked "TBD" — a salesman quoting from an old list creates billing friction at delivery time.

**F. Scaling ceiling.** Every new salesman or brand adds linearly to the accountant's transcription load. The accountant is the funnel through which the whole business flows.

## 4. Stakeholders and what each needs

| Stakeholder | Needs from this project |
|---|---|
| **Salesman** | Take an order *faster than the notebook*, one-handed, in a busy shop on spotty 4G; fix a mistake within a grace window; see his own order history and status. |
| **Accountant** | See orders the moment they're submitted, legibly and completely; lock an order before booking it into Tally; make post-lock corrections herself (with a trace); print a pick slip for the godown. |
| **Godown staff** | A legible, complete pick list — today an invoice copy, tomorrow a printed slip from the dashboard. No app to learn. |
| **Owner** | Real-time view of the day's orders; fewer disputes; a foundation that later kills the Tally re-typing and surfaces outstanding balances. |
| **Retailer** | Accurate orders, accurate invoices, faster delivery. (Never a user of the app.) |

## 5. What success looks like (measurable)

1. **Adoption is the metric that matters**: after a one-week parallel run (app + notebook side by side), the pilot salesman chooses the app voluntarily. If the app is slower than the notebook, the project has failed regardless of code quality.
2. A typical order (5–8 lines) is captured in **under 90 seconds**.
3. The accountant sees an order **within a minute** of submission, not hours.
4. **Zero "couldn't read it" errors** on app-captured orders.
5. A pick slip can be in the godown's hands the same hour the order is taken.
6. Every dispute is answerable from the order's audit trail (who entered what, when, and who changed it).

## 6. Explicitly out of scope

- **Not an ERP.** No inventory quantities, no accounting, no GST computation or filing — Tally keeps all of it. The app never needs to know stock levels to accept an order.
- **No payment handling.** Phase 4 adds *read-only* outstanding visibility; money never moves through the app.
- **No retailer-facing anything.** The salesman is the user; retailers never see the app.
- **No offline-first engineering.** The app is *resilient* (drafts survive dead zones via local storage; submits retry) but not a synchronizing offline database. See [architecture.md](architecture.md).

## 7. Buy vs build

This category exists off the shelf: India has a mature DMS/SFA SaaS industry (Bizom, FieldAssist, SalesDiary and peers), plus Zoho-with-Tally connectors and Vyapar-class tools, typically priced per user per month. At 1–2 users the fees would be modest. We are building custom anyway — with eyes open — because: the workflow fit is exact (order-not-invoice capture, Tally sales-order import, per-brand rounds, a 2-hour grace window); running cost is near zero at this scale; the owner keeps full control of data and pace; and the owner wants a system he owns and can extend. Recorded as decision **D7** in [decisions.md](decisions.md).
