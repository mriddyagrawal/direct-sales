# Phase 2 (+4) — Tally sync architecture (design note)

**Status:** design captured 2026-07-07, **not built.** Owner will decide later whether/how. Relates to PLAN **Phase 2** (Tally import) & **Phase 4** (collections), the [decisions.md](decisions.md) graveyard (browser→`localhost:9000` is dead), and [catalog-admin-design.md](catalog-admin-design.md) (`tally_name` mapping).

## The constraint that shapes everything
The app DB is **cloud** (Supabase, Mumbai). **Tally is on-premise** — a desktop app on an office PC, behind the office router, no public address. So:
- The cloud can't reach into Tally.
- A **browser cannot** hit Tally's `localhost:9000` (CORS / Private Network Access / mixed content — killed in the decisions graveyard, "Path B").
- A **local agent** on the office PC (or same LAN) *can* talk to both: it reads Supabase over HTTPS (outbound from the office — works) and talks to Tally's local **HTTP-XML server** (`:9000`) or file Import/Export. **That agent is the sync engine** — PLAN Phase 2's "Path C".

## Tally's integration surfaces
- **File XML import/export** (Gateway of Tally) — simplest; no agent, manual clicks. PLAN "Path A".
- **HTTP-XML server** (`:9000`) — Tally accepts XML over the LAN (query + post vouchers). What the agent uses.
- **ODBC** — read-mostly querying.
- (TDL for deeper Tally customization — advanced, probably unnecessary.)

## Directional sync — NOT a symmetric two-way merge
Keep clear ownership: **Tally is authoritative for accounting & masters; the app is authoritative for order capture.** Sync one-way *per data type*:
- **App → Tally:** processed orders → **Sales Order vouchers** (Phase 2 core). Idempotent — mark `exported_at`, carry `order_ref` in the voucher narration; re-sync never duplicates.
- **Tally → App:** pull **master data** to keep `tally_name` / `tally_ledger_name` mappings fresh as the accountant renames items/ledgers (and to store Tally **GUIDs**, which survive renames); and pull **outstanding balances** for the Phase-4 collections view.

A two-way *merge* of the same records invites conflicts — avoid it.

## The hard part is mapping, not transport
- **Master-data mapping + idempotency** is the real work: products ↔ stock-items, retailers ↔ party-ledgers, and never creating a duplicate voucher. Continuous sync makes mapping **drift** a live problem — which is why a maintained `tally_name` (or a stored Tally GUID) matters more the more you sync.
- **The agent is an ops burden:** must run always-on, survive reboots; Tally must be open + HTTP server enabled + the company loaded.

## Recommended path — earn the complexity
At **<20 orders/day**, don't build a live-sync engine prematurely:
1. **Phase 2 start:** one-way **app → Tally via file import** — export a file, import in Tally (two clicks). May be the *permanent* answer at this scale.
2. **Add the local agent + Tally→app pulls** only when the manual step (or mapping drift) genuinely hurts — likely alongside **Phase 4** (balances).
3. Always test against a **Tally test company file** first (PLAN Phase 2).

## Open (decide when picked up)
- Voucher type: **Sales Order** (recommended, PLAN) vs Sales Invoice.
- Map by **name** (simple) vs also store the Tally **GUID** (survives renames — better for ongoing sync).
- Cadence: manual / on-demand vs periodic agent. Real-time is unnecessary at this scale.
