# Proposed Solution: Ganpati Enterprises Direct Sales App

## 1. Executive Summary
To resolve the inefficiencies of the manual, paper-based order system, we propose a centralized, cloud-hosted web application tailored specifically for B2B direct sales. The application will serve two primary interfaces: a mobile-optimized "Quick Order" view for field salesmen, and a desktop-optimized dashboard for the accountant and management.

## 2. Core Architecture & Tech Stack
The application will be built using modern, highly scalable web technologies:
* **Frontend & API**: **Next.js (React)**. 
* **Database & Authentication**: **Supabase (PostgreSQL)**. 
* **Hosting**: **Vercel**. 
* **Styling**: **Vanilla CSS**. 

## 3. The Salesman Experience (Mobile-First)
* **Single-Page Catalog**: Categorized list of all available products.
* **Inline Steppers**: Quantity steppers (`[ - ] 0 [ + ]`) next to every item.
* **Sticky Cart Bar**: Instantly updates total items and monetary value.
* **Real-time Search**: Instantly filter SKUs.

## 4. The Accountant Experience (Desktop-Optimized)
* **Live Dashboard**: Real-time incoming orders.
* **Order Details View**: View exact line items, quantities, and salesman details.

## 5. Architectural Integrity: Order State Machine & Editability
To ensure financial safety and allow salesmen to fix mistakes, the system will employ a strict state machine for every order.

### A. The Editability Window
Mistakes happen (e.g., the retailer changes their mind 5 minutes after the salesman leaves). Orders will follow this state flow:
1. **DRAFT**: While the salesman is adding items, the order is safely cached but not visible to the accountant.
2. **SUBMITTED (Editable)**: When the salesman hits submit, the order appears on the accountant's dashboard. However, a **2-hour countdown timer** begins. During this window, the salesman can re-open the order on their phone and edit quantities.
3. **LOCKED (Ready for Sync)**: After 2 hours (or if the accountant manually clicks "Lock & Process"), the order becomes read-only for the salesman. At this point, it is ready to be pushed to Tally. If a change is needed now, the salesman must call the accountant.

### B. Serialization & Uniqueness
Invoices must be legally and chronologically sound. We cannot rely on random IDs (like UUIDs) for the invoice numbers shown to humans or Tally.
* **Strict Sequence Generation**: Supabase (PostgreSQL) will use a highly concurrent `SEQUENCE` function to generate gapless, auto-incrementing numbers (e.g., `1001`, `1002`). This prevents race conditions if two salesmen submit an order at the exact same millisecond.
* **Prefixing**: The system will format these into human-readable, unique identifiers (e.g., `ORD-ZEB-2026-1001`). 

## 6. Immutable Snapshots
* When an order enters the **SUBMITTED** state, the system copies the `product_name` and `price` at that exact moment into the `order_items` table.
* **Why this matters**: If Zebronics updates their price list next month, the prices on all historical orders remain completely unchanged.

## 7. Phase 2: Accounting Software (Tally) Integration
* The dashboard will include an export feature to generate Tally-compatible XML batches for quick manual imports.
* Alternatively, a Desktop Sync Agent can pull **LOCKED** orders and push them directly to Tally's local API.
