# Project Plan & Phased Architecture

This document breaks down the development of the Ganpati Enterprises Direct Sales app into standalone, iterative phases. For each phase, we explore the different architectural paths and industry standards available.

---

## Phase 1: The Core MVP (Digital Order Collection)
**Goal**: Eliminate paper by giving salesmen a digital order interface and providing the accountant with a real-time dashboard.

### Path Options for the Salesman UI
*   **Path A: Traditional B2C E-commerce (The "Amazon" Model)**
    *   *Concept*: Large product images, individual detail pages, and a multi-step checkout.
    *   *Pros*: Familiar to consumers.
    *   *Cons*: Too slow for B2B. Requires too many taps to add multiple items.
*   **Path B: The "Quick Order" List (Chosen Standard)**
    *   *Concept*: A dense, categorized list of products with inline `[ - ] 0 [ + ]` steppers. A sticky cart total sits at the bottom.
    *   *Pros*: The industry standard for B2B field sales. It is incredibly fast, allows one-handed thumb use, and mimics the speed of writing on paper.

### Path Options for Database & Infrastructure
*   **Path A: SQLite + Local Hosting** (Simple, but hard to scale and sync).
*   **Path B: Supabase (PostgreSQL) + Vercel (Chosen)**
    *   *Pros*: Enterprise-grade database, built-in user authentication (Row Level Security ensures salesmen only see their own orders), and edge-network speed so the app loads instantly even on bad mobile data.

**Phase 1 Deliverables**: 
1. Supabase schema with "Immutable Snapshots" (locking prices at checkout) and a **PostgreSQL Sequence** for gapless, unique order numbering (e.g., `ORD-1001`).
2. Order State Machine: Orders are editable by the salesman for a **2-hour window** after submission, after which they are LOCKED for the accountant.
3. Mobile-first Salesman Quick Order UI.
4. Desktop-first Accountant Dashboard.

---

## Phase 2: Accounting Software Integration (Tally ERP)
**Goal**: Eliminate the accountant's manual data entry by bridging the cloud app with the local Tally software.

Tally communicates natively via XML over a local HTTP port (`localhost:9000`). Because our app is in the cloud (Vercel), it cannot directly ping your office PC.

### Path Options for Tally Integration
*   **Path A: Manual XML/CSV Batch Export**
    *   *Concept*: The dashboard generates a Tally-compliant XML file. The accountant downloads it and imports it manually.
    *   *Pros*: Very easy to build, zero risk to your local network.
    *   *Cons*: Still requires manual clicks; not real-time.
*   **Path B: Local Network Browser Push**
    *   *Concept*: When the accountant clicks "Sync to Tally" on the dashboard, the *browser itself* sends the XML to `localhost:9000`. 
    *   *Pros*: Feels like magic; doesn't require installing desktop software.
    *   *Cons*: Can be blocked by strict browser security policies (CORS).
*   **Path C: The Desktop Sync Agent (The Industry Standard)**
    *   *Concept*: We write a tiny background script that runs on the accountant's PC. It securely asks Supabase for new orders every 5 minutes and pushes them directly into Tally.
    *   *Pros*: Highly reliable, completely automated, and handles internet drops gracefully.

**Recommendation for Phase 2**: Start with Path A (Manual XML Export) to verify the data structure, then immediately upgrade to Path C (Desktop Sync Agent) for complete automation.

---

## Phase 3: Multi-Brand Expansion & Sub-Organizations
**Goal**: Support additional brands beyond Zebronics and handle a larger sales team.

### Path Options for Brand Separation
*   **Path A: Unified App with Brand Filters**
    *   *Concept*: One single app where the salesman selects "Zebronics" or "Brand X" from a dropdown menu to swap the catalog.
    *   *Pros*: Easiest to maintain, single login for salesmen.
*   **Path B: Distinct Subdomains**
    *   *Concept*: Deploying `zebronics.ganpati.com` and `otherbrand.ganpati.com`.
    *   *Pros*: Complete visual and data isolation.
    *   *Cons*: Overkill unless you have dedicated salesmen who *only* sell one brand and never mix them.

**Recommendation for Phase 3**: Path A. A unified app with aggressive filtering is much faster for a salesman who might sell multiple brands to a single retailer.

---

## Phase 4: Dynamic Pricing & Negotiation
**Goal**: Allow salesmen to negotiate and alter prices on the fly without breaking the accounting system.

### Path Options for Price Control
*   **Path A: Free-form Price Overrides** (Salesman can type any number. High risk of mistakes or unauthorized discounts).
*   **Path B: Pre-defined Discount Tiers** (Salesman can select 5%, 10%, or 15% discount buttons, but cannot type random numbers).
*   **Path C: Manager Approval Workflow**
    *   *Concept*: If a salesman changes a price below the standard threshold, the order goes into a "Pending Approval" state on the dashboard. The accountant/manager must click "Approve" before it goes to Tally.

**Recommendation for Phase 4**: A hybrid of Path B and Path C provides the best balance of flexibility for the salesman and financial security for the business.
