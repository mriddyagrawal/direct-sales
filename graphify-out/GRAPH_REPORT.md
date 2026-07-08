# Graph Report - .  (2026-07-07)

## Corpus Check
- 131 files · ~263,942 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 491 nodes · 945 edges · 39 communities (36 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.82)
- Token cost: 58,000 input · 10,410 output

## Community Hubs (Navigation)
- [[_COMMUNITY_New Order Flow|New Order Flow]]
- [[_COMMUNITY_Phase 1 Design Engine|Phase 1 Design Engine]]
- [[_COMMUNITY_Order Workbench Admin|Order Workbench Admin]]
- [[_COMMUNITY_Planning Archive & Session Docs|Planning Archive & Session Docs]]
- [[_COMMUNITY_Design Brief & Review Log|Design Brief & Review Log]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Supabase Auth & Middleware|Supabase Auth & Middleware]]
- [[_COMMUNITY_Offline Order Sync|Offline Order Sync]]
- [[_COMMUNITY_Order Detail Page|Order Detail Page]]
- [[_COMMUNITY_Date Range Demo|Date Range Demo]]
- [[_COMMUNITY_Login Flow|Login Flow]]
- [[_COMMUNITY_Retailers Admin Screen Design|Retailers Admin Screen Design]]
- [[_COMMUNITY_Order RPC Layer|Order RPC Layer]]
- [[_COMMUNITY_Orders Dashboard Design|Orders Dashboard Design]]
- [[_COMMUNITY_Review & Submit Screen Design|Review & Submit Screen Design]]
- [[_COMMUNITY_Order Detail Screen Design|Order Detail Screen Design]]
- [[_COMMUNITY_Converted Screens Overview|Converted Screens Overview]]
- [[_COMMUNITY_Login Screen Design|Login Screen Design]]
- [[_COMMUNITY_Orders Home Screen Design|Orders Home Screen Design]]
- [[_COMMUNITY_Dashboard Layout & Nav|Dashboard Layout & Nav]]
- [[_COMMUNITY_Products Pricing Admin|Products Pricing Admin]]
- [[_COMMUNITY_Instrument Design Direction|Instrument Design Direction]]
- [[_COMMUNITY_Retailers Queue Admin|Retailers Queue Admin]]
- [[_COMMUNITY_App Root Layout|App Root Layout]]
- [[_COMMUNITY_Pick Retailer Screen Design|Pick Retailer Screen Design]]
- [[_COMMUNITY_Quick Order Screen Design|Quick Order Screen Design]]
- [[_COMMUNITY_Bottom Tab Nav Design|Bottom Tab Nav Design]]
- [[_COMMUNITY_Print Documents Design|Print Documents Design]]
- [[_COMMUNITY_Middleware & Proxy|Middleware & Proxy]]
- [[_COMMUNITY_App Brand Assets|App Brand Assets]]
- [[_COMMUNITY_Design Overview Sheet|Design Overview Sheet]]
- [[_COMMUNITY_App Icons|App Icons]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_PWA Maskable Icon|PWA Maskable Icon]]

## God Nodes (most connected - your core abstractions)
1. `formatRupees()` - 23 edges
2. `createClient()` - 21 edges
3. `compilerOptions` - 16 edges
4. `createClient()` - 12 edges
5. `Decision Log (D1–D11 + Graveyard)` - 12 edges
6. `Button()` - 11 edges
7. `Data Model Spec (Postgres Schema, 7 tables, RPCs, triggers)` - 11 edges
8. `NewOrderFlow()` - 10 edges
9. `formatOrderTimestamp()` - 10 edges
10. `getOrderStatusTag()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Client-Generated Order UUID for Idempotent Submit (no double rows on retry)` --conceptually_related_to--> `Order State Machine: submitted → locked → processed/cancelled`  [INFERRED]
  Prompts/salesman-app-builder-prompt.md → PLAN.md
- `parseDataProps()` --references--> `Json`  [EXTRACTED]
  design/phase1/support.js → src/lib/types/database.types.ts
- `boot()` --references--> `react-dom`  [EXTRACTED]
  design/phase1/support.js → package.json
- `Project Plan & Phased Architecture v0` --rationale_for--> `Direct Sales — Phased Roadmap (PLAN.md)`  [INFERRED]
  archive/PLAN-v0.md → PLAN.md
- `Problem Statement v0 — Ganpati Enterprises` --rationale_for--> `Ganpati Enterprises Direct Sales — README Orientation`  [INFERRED]
  archive/problem-statement-v0.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Phase 1 Builder Milestone Chain: M1 Backend → M1/M3 Foundation → M4 Salesman → M5 Dashboard** — prompts_supabase_setup_builder_prompt_doc, prompts_app_foundation_builder_prompt_doc, prompts_salesman_app_builder_prompt_doc, prompts_accountant_dashboard_builder_prompt_doc [EXTRACTED 1.00]
- **Data Integrity Core: Paise Money + Immutable Snapshots + RLS Enforcement + Order State Machine** — concept_paise_money_storage, concept_immutable_price_snapshots, concept_rls_enforcement, concept_order_state_machine [INFERRED 0.95]
- **Post-Milestone UI Fix Prompts: Bottombar + Dashboard UX + Column Hierarchy + Salesman Flow** — prompts_fix_bottombar_builder_prompt_doc, prompts_fix_dashboard_ux_builder_prompt_doc, prompts_fix_orders_column_hierarchy_builder_prompt_doc, prompts_fix_salesman_neworder_flow_builder_prompt_doc [INFERRED 0.85]
- **Order Integrity Guarantee: RPC guards + immutable snapshots + idempotent submit** — docs_specs_data_model_rpc_write_model, docs_specs_data_model_snapshot_pattern, docs_specs_order_lifecycle_idempotent_submit, docs_specs_data_model_schema_spec [INFERRED 0.95]
- **Cross-Phase Tally Integration Architecture: boundary + Phase 2 sync + catalog admin + schema** — docs_architecture_tally_boundary, docs_phase2_tally_sync_design_tally_sync_arch, docs_catalog_admin_design_import_design, docs_specs_data_model_schema_spec [INFERRED 0.85]
- **Username Auth System: design decision + provisioning runbook + RLS spec + test accounts** — docs_decisions_username_login, docs_add_user_runbook_provisioning, docs_specs_roles_and_permissions_rls_matrix, docs_m1_test_accounts_rls_test_accounts [INFERRED 0.85]
- **All T2 instrument screens share ledger aesthetic** — design_phase1_renders_t2_00_orders_ledger_desktop, design_phase1_renders_t2_00_quick_order_mobile, design_phase1_renders_t2_00_order_detail_workbench [INFERRED]

## Communities (39 total, 3 thin omitted)

### Community 0 - "New Order Flow"
Cohesion: 0.07
Nodes (47): ConfirmedOrder, FlowAction, flowReducer(), FlowState, NewOrderFlow(), NewOrderFlowProps, Step, EditOrderData (+39 more)

### Community 1 - "Phase 1 Design Engine"
Cohesion: 0.07
Nodes (46): boot(), collectProps(), compileAttr(), compileTemplate(), contentKey(), createComponentFactory(), createExternalModules(), createHelmetManager() (+38 more)

### Community 2 - "Order Workbench Admin"
Cohesion: 0.09
Nodes (44): OrderItemRow, OrderWorkbench(), OrderWorkbenchProps, RawEventRow, WorkbenchOrderData, CatalogProduct, PickSlip(), PickSlipItem (+36 more)

### Community 3 - "Planning Archive & Session Docs"
Cohesion: 0.12
Nodes (29): Original Planning Conversation Export, Project Plan & Phased Architecture v0, Problem Statement v0 — Ganpati Enterprises, Proposed Solution v0 — Direct Sales App, Direct Sales — Session Roles (CLAUDE.md), BUILDER/REVIEWER Two-Session Claude Loop, Ganpati Enterprises — B2B Distribution Business (Problem Owner), Client-Generated Order UUID for Idempotent Submit (no double rows on retry) (+21 more)

### Community 4 - "Design Brief & Review Log"
Cohesion: 0.15
Nodes (29): Builder/Reviewer Two-Session Loop: BUILDER commits, REVIEWER verifies by execution, blocking issues fixed next commit, Review Log — Ganpati Enterprises, Phase 1 Design Brief, Phase 1 Design Spec (Extracted from Claude Design), Instrument Design Grammar: ledger not dashboard, hairlines, tabular mono, flat status tags, Ganpati Phase 1 Claude Design Canvas (instrument grammar, all 11 screens, tokens), Add User Runbook (Login Provisioning), System Architecture Document (+21 more)

### Community 5 - "Project Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, next, react-day-picker, server-only, @supabase/ssr, @supabase/supabase-js, devDependencies, eslint (+13 more)

### Community 6 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 7 - "Supabase Auth & Middleware"
Cohesion: 0.19
Nodes (11): SUPABASE_COOKIE_OPTIONS, ROLE_HOME, CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums (+3 more)

### Community 8 - "Offline Order Sync"
Cohesion: 0.33
Nodes (13): PendingOrdersStrip(), OfflineError, EMPTY, getServerSnapshotPending(), listPending(), listPendingSnapshot(), markPendingFailed(), notifyChange() (+5 more)

### Community 9 - "Order Detail Page"
Cohesion: 0.20
Nodes (10): EventRow, OrderItemRow, WorkbenchOrderRow, WorkbenchPage(), PickSlipItemRow, PickSlipOrderRow, PickSlipPage(), ProductsPage() (+2 more)

### Community 10 - "Date Range Demo"
Cohesion: 0.29
Nodes (9): addDays(), DateRangeDemo(), fmt(), Preset, PRESETS, rangeLabel(), sameRange(), startOfDay() (+1 more)

### Community 11 - "Login Flow"
Cohesion: 0.26
Nodes (7): LoginState, signInWithUsername(), initialState, LoginForm(), LoginFormProps, LoginPageProps, createServiceClient()

### Community 12 - "Retailers Admin Screen Design"
Cohesion: 0.22
Nodes (11): Deactivated Retailer Row, Design System Foundation Panel, Empty Queue State, Retailer Filter Tabs, Inline Edit Row — Pending Retailer, Top Navigation Tabs, Retailers Table, Retailers List Screen (Desktop) (+3 more)

### Community 13 - "Order RPC Layer"
Cohesion: 0.38
Nodes (10): callRpc(), cancelOrder(), isOfflineFailure(), OrderRow, processOrder(), RpcErrorLike, submitOrder(), toItemsPayload() (+2 more)

### Community 14 - "Orders Dashboard Design"
Cohesion: 0.22
Nodes (10): S8 Design Decision: Keyboard-First Navigation, S8 Design Decision: No-Refresh Live Updates, S8 Design Decision: Order Ref Gaps Are Normal, S8 App Header Bar, S8 Live Status Badge, S8 Loading Skeleton Variant (S8·b), S8 Orders Filter Bar, S8 Orders Table (+2 more)

### Community 15 - "Review & Submit Screen Design"
Cohesion: 0.31
Nodes (9): S5-c: Submit Button States, S6: Confirmation — Proof + Edit-Window Promise, Post-Submit Edit Window, Notes for the Office Field, Order Reference Number (ORD-YYYY-NNNN), S5-a: Review Order — Default State, Review → Submit → Confirmation (S5–S6), S5-b: Submit Failed / Offline — Saved, Not Lost (+1 more)

### Community 16 - "Order Detail Screen Design"
Cohesion: 0.31
Nodes (9): Cancel Order Confirm Dialog, Edit Window Countdown Timer (Status Chip), Plain-Words History / Event Log, Immutable Line Items Snapshot, S7 Order Detail (Salesman) — History, Disputes, Edit/Cancel, S7-d Cancelled State + Confirm Dialog, S7-a Editable State — Countdown Running, S7-b Locked State — Read-Only (+1 more)

### Community 17 - "Converted Screens Overview"
Cohesion: 0.42
Nodes (9): S10 Pick Slip — A4 Prices Off (Godown), S1 Login Screen — Get In Once, S3 Pick Retailer — Recents First, S3 States — Quick-Add / Resume-Draft, S5-off / S6 — Offline Submit / Order Confirmation, S5 Review — Confirm Before Submit, S7 Order Detail — Editable, S7 States — Locked / Processed / Cancelled (+1 more)

### Community 18 - "Login Screen Design"
Cohesion: 0.39
Nodes (8): Red = Errors and Cancelled Only — Color System Rule, Ganpati Enterprises Brand Identity, 48px+ Touch Target Design Constraint, No Self-Service Password Reset — Call the Office, S1 Login Screen — Get In Once Then Never Again, Session Persistence ~30 Days Design Decision, S1-a Login Default State, S1-b Login Error States

### Community 19 - "Orders Home Screen Design"
Cohesion: 0.39
Nodes (8): Empty State (S2-c), New Order CTA Button, Offline Pinned Order Card (S2-b), Order Card Component, S2 My Orders — Launch Pad + History Screen, TODAY / EARLIER Section Dividers, Loading Skeleton State (S2-d), Order Status Chip

### Community 20 - "Dashboard Layout & Nav"
Cohesion: 0.32
Nodes (5): DashboardLayout(), DashboardNav(), DashboardNavProps, TABS, SignOutButton()

### Community 21 - "Products Pricing Admin"
Cohesion: 0.36
Nodes (5): ProductRow, EditForm, ProductsPricing(), Field(), FieldProps

### Community 22 - "Instrument Design Direction"
Cohesion: 0.48
Nodes (7): Instrument Design System — T2 Principles, Instrument Atoms — Chips, Stepper, Figures, Buttons, S8: Order Detail — The Workbench, S8: Orders Ledger — Desktop Live, S4: Quick Order — Mobile Hero, T2 — Direction Shift: SaaS Dashboard to Instrument, Order Status State Machine

### Community 23 - "Retailers Queue Admin"
Cohesion: 0.47
Nodes (4): RetailerRow, EditForm, FilterTab, RetailersQueue()

### Community 24 - "App Root Layout"
Cohesion: 0.40
Nodes (3): jetBrainsMono, metadata, spaceGrotesk

### Community 25 - "Pick Retailer Screen Design"
Cohesion: 0.83
Nodes (4): Quick-Add New Shop Form (S3-d), Resume Draft Order Bottom Sheet (S3-e), Retailer Search Component — Live Substring Match, Pick Retailer Screen (S3) — New Order Step 1

### Community 26 - "Quick Order Screen Design"
Cohesion: 0.50
Nodes (4): Quick Order List — sticky cart bar, Quick Order List — direct-entry keypad overlay, S4 Quick Order List — hero screen (notebook killer), Quick Order List — sticky search bar

### Community 27 - "Bottom Tab Nav Design"
Cohesion: 0.67
Nodes (4): Bottom Tab Bar Component, Instrument Design System — Tab Bar Rules, S2 My Orders Screen with Bottom Tab Bar, T3 — Instrument Home + Bottom Tab Bar

### Community 28 - "Print Documents Design"
Cohesion: 0.67
Nodes (4): Print Template Design Decisions, S10-b: Packing Slip (Warehouse Copy — No Prices), S11: Retailer Order Copy (With Prices), Print Templates: Packing Slip (S10-b) + Retailer Order Copy (S11)

### Community 29 - "Middleware & Proxy"
Cohesion: 0.67
Nodes (3): updateSession(), config, proxy()

### Community 30 - "App Brand Assets"
Cohesion: 1.00
Nodes (3): App Favicon — Receipt Icon, Brand Identity — Direct Sales App, Receipt / Invoice Visual Metaphor

### Community 31 - "Design Overview Sheet"
Cohesion: 0.67
Nodes (3): Phase 1 Design System Tokens, S4 Quick Order — Live Interactive Demo, T1 — Phase 1 Design Overview (Title Screen)

### Community 32 - "App Icons"
Cohesion: 1.00
Nodes (3): Apple Touch Icon, App Brand Identity, Browser Favicon

## Knowledge Gaps
- **133 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+128 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Json` connect `Offline Order Sync` to `New Order Flow`, `Phase 1 Design Engine`, `Supabase Auth & Middleware`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `parseDataProps()` connect `Phase 1 Design Engine` to `Offline Order Sync`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Project Dependencies` to `Phase 1 Design Engine`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _137 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `New Order Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.07344632768361582 - nodes in this community are weakly interconnected._
- **Should `Phase 1 Design Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.07199032062915911 - nodes in this community are weakly interconnected._
- **Should `Order Workbench Admin` be split into smaller, more focused modules?**
  _Cohesion score 0.08583959899749373 - nodes in this community are weakly interconnected._