# Godown fulfilment + LG serial capture — design

**Status:** designed, not built (2026-07-09). The keystone feature that motivated the whole app: it replaces the "godown photographs every QR into WhatsApp → accountant reads the photos" step with in-app serial scanning and a clean hand-off to the accountant.

> **Stage 1 shipped 2026-07-11 — all-brand fulfilment + partial picking + backorder split.** The godown now fulfils **every** brand (approval routes all brands to `approved`, not just LG). The pick is **brand-aware**: LG scans serials as below; fixed brands (Zeb/Lum) enter a **picked quantity** per line (a stepper on the same pick screen — no scanner, no serials). A pick may be **partial** — the Submit button is live at ≥1 unit; `submit_pick` ships the picked qty (→ `ready_to_bill`, `total_paise` = Σ picked×price) and, when any line is short, **splits** off a new **`backorder`** child order (same salesman, `parent_order_id` link, fresh gapless `order_no`) holding the remainder. A backorder re-enters the pipeline via **`punch_order`** (`backorder → pending_approval`, its salesman or an admin), and is freely editable until punched. Ordered line snapshots stay immutable — `order_items.picked_qty` is additive. Godown RLS widened from `requires_scan`-only to **all-brand** `approved`/`ready_to_bill`. Serials stay LG-only; godown screens stay price-free. Anyone may reach the pick via `/scan/[id]` (universal-scan); the godown `/godown` queue lists all-brand approved orders. *(Stage 2 — dispatch/`dispatched` + godown Pickup/Dispatch/History tabs — is parked.)*

## Real-world flow (LG)
1. Salesman negotiates at the shop → submits an LG order (manual price) → **`pending_approval`**.
2. Owner ("dad") approves the price → **`approved`**. *(all of this already shipped, Phase 3b)*
3. **Godown person** pulls the physical units to the main godown / patio, and **scans each unit's serial barcode** with their phone.
4. On submit, the order → **`ready_to_bill`**; the **accountant** reads the serials off the app and enters the bill into **Tally by hand** (auto-Tally sync is a later phase).

## Scope (v1)
- **LG only** for the scan step. Since the lifecycle overhaul (2026-07-10) **every** brand goes through admin approval; `brands.requires_scan` (renamed from `requires_approval`) decides what approval routes to — LG → `approved` (godown scans next), fixed brands → straight `ready_to_bill` (no godown step, no serials).
- **Accountant still bills manually in Tally** — the app just hands them structured serials instead of WhatsApp photos.
- **Prices are hidden from the godown in the UI only** (owner decision — no server-side price-stripping; prices may ride along in payloads, they're just not rendered). Low-risk internal role, not worth extra security.

## New role: `godown`
- A **mobile** role like the salesman (they scan on their phone).
- Added to the `profiles` role check and to middleware `ROLE_HOME` → home `/godown`.
- Sees **only** its pick queue — no accountant dashboard, no salesman app.

## State machine (additions to the existing lifecycle)
```
pending_approval (EVERY brand) → approved (requires_scan) → ready_to_bill → billed
                │  └→ ready_to_bill (fixed, no scan)   │ └──→ billed  (accountant OVERRIDE, kept)
                                  └→ cancelled          ready_to_bill → cancelled
```
`guard_order_transition` gains:
| From | To | Who | Notes |
|---|---|---|---|
| `approved` | `ready_to_bill` | **any active role** (2026-07-11) | via `submit_pick`; stamps `picked_at/by`; every line fully scanned. Was godown-only; opened to admin/accountant/salesman (salesman scoped to his own order in the RPC). The guard no longer role-checks this edge — `submit_pick` is the gatekeeper. |
| `approved` | `billed` | accountant/admin | **override kept** — accountant can bill without the godown step for exceptions |
| `ready_to_bill` | `billed` | accountant/admin | the normal bill path, now with serials in hand |
| `ready_to_bill` | `cancelled` | accountant/admin | reason required |

`process_order` accepts **both** `approved → billed` (override) and `ready_to_bill → billed`. (Status value/event say `billed` since 2026-07-10; the RPC name and `processed_at/by` columns are internal plumbing.)

## Data model
```sql
-- one row per physical unit scanned
create table order_item_scans (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  raw_scan      text not null,               -- exact scanner output, e.g. 'W5LN606NWFG207155IN' — never lossy
  serial        text not null,               -- cleaned serial, e.g. '606NWFG207155' (what Tally wants)
  scanned_at    timestamptz not null default now(),
  scanned_by    uuid not null references profiles(id)
);
-- uniqueness is WITHIN-BILL ONLY (owner decision, 2026-07-10): no unique
-- index on serial — the same physical unit may legitimately reappear on
-- later bills (returns / cancellations / re-sales the app can't see yet).
-- A serial can never appear twice on the SAME bill: instant client reject
-- on the pick screen + an explicit within-batch check in submit_pick.

alter table orders add column picked_at timestamptz;
alter table orders add column picked_by uuid references profiles(id);
```
- **Cancel handling:** a cancelled bill **keeps its scan record** (audit). Nothing needs freeing — serials aren't globally unique, so re-scanning a returned/cancelled unit on a new bill just works.
- **Accepted risk (owner):** the same box scanned onto two live orders is no longer caught — a non-blocking "also seen on ORD-…" hint in the workbench serials panel is the possible later mitigation.
- Picked count per line = `count(*) from order_item_scans where order_item_id = …`. Submit requires it to equal `qty` for **every** line.

## Serial extraction from the barcode
**Validated across 8 serials / 5 categories** (washing machine, TV, microwave, AC, dishwasher). Raw scan = **`[4-char prefix] + [13-char serial] + "IN"`** (e.g. `W5LN`·`606NWFG207155`·`IN`, `JSQM`·`605SRQL003036`·`IN`). The 13-char serial is **exactly what Tally stores** (its Batch/Lot tracking field), so our clean serial must equal it.

Serial format is strikingly consistent: **`\d{3}[A-Z]{4}\d{6}`** (3 digits = mfg year+month, 4 letters = line code, 6-digit sequence). Confirmed examples across categories:
`606NWFG207155`, `605SRQL003036`, `606NWVK355671`, `604PLUH304766`, `605NMUX050638`, `605NMME027139`, `604PAZQ162437`, `604PAPD162456`.

**Extraction rule:**
1. **Primary — regex `/\d{3}[A-Z]{4}\d{6}/`** on the raw scan → the serial. Self-validating and robust: the `W5LN`/`JSQM` prefix and `IN` suffix can't false-match (no 3-digit run), so it holds even if the prefix length ever changes.
2. **Fallback — position strip** `raw.slice(4).replace(/IN$/,'')` if the regex ever misses.
3. **Always keep `raw_scan`**; if neither yields a plausible 13-char serial, surface a **manual-entry** field. Nothing is ever lost.

(The clean serial == Tally's tracking-number / Batch-Lot field — directly relevant when the Phase 2 auto-push arrives.)

## Godown app (`/godown`, mobile)
1. **Queue** — approved LG orders awaiting pick (ref, retailer, item count; **no prices**), newest first.
2. **Order** — the lines (**qty + item only**). Tap a line → it's the active line to scan.
3. **Scan** — phone camera scans the serial barcode; each valid scan records against the active line and bumps progress (`2 / 3`). Client-side dup check within the order for instant feedback; a bad/duplicate scan shows an inline error; unparseable → manual-entry field.
4. **Submit** — enabled only when **every line is fully scanned**. Calls `submit_pick`; on success the order → `ready_to_bill` and drops off the queue (accountant notified via Realtime, like new orders today).
- **Offline-friendly:** scans accumulate client-side and go up in one `submit_pick` batch, so a warehouse dead-spot doesn't block picking (same spirit as the salesman's offline submit queue). Authoritative uniqueness check happens server-side on submit.

## RPCs
- **`submit_pick(p_order_id uuid, p_scans jsonb)`** — security definer. Validates: caller is an **active profile** (any role — 2026-07-11, was godown-only), and a **salesman may only scan his own order** (`v_order.salesman_id = caller`, defense-in-depth since the RPC bypasses RLS); order is `approved` + an approval (LG) brand; every line's scan count == qty; **no cleaned serial appears twice within this submission** (within-bill uniqueness — cross-bill reuse is allowed by design). Inserts `order_item_scans`, stamps `picked_at/by`, transitions `approved → ready_to_bill`, logs an `order_events` row (`picked`). Rejects a within-bill duplicate by naming the serial. Reached from the godown queue **and** the universal `/scan/[id]` screen (Scan button on an approved order, all roles).
- Godown **reads** the queue/order directly (RLS-scoped) — no read RPC (prices hidden in UI only).

## RLS / permissions
- **godown** `select` on `orders` where `status in ('approved','ready_to_bill')` and the brand is an approval (LG) brand; `select` on the matching `order_items` + `order_item_scans`. Writes go only through `submit_pick` (security definer) — no direct insert grant needed.
- **accountant/admin** unchanged, plus they see `ready_to_bill` orders + their scans.
- **salesman** sees `ready_to_bill` as read-only "being packed / ready to bill" (behaves like `approved`).

## Accountant hand-off
- Orders dashboard gains a **`Ready to bill`** status tab.
- Opening a `ready_to_bill` order shows each line marked **picked ✓** with its **serial list**; the accountant types the Tally bill (reading serials on screen), then **Mark billed** (`ready_to_bill → billed`).

## Migrations (6)
| # | Change |
|---|---|
| 1 | `profiles` role check → add `'godown'` |
| 2 | `orders.status` check + `guard_order_transition` → add `ready_to_bill` and its transitions (godown submit, accountant override kept) |
| 3 | `orders.picked_at`, `orders.picked_by` |
| 4 | `order_item_scans` table + RLS (serials within-bill unique only — no serial index) |
| 5 | `submit_pick` RPC; `process_order` also accepts `ready_to_bill → billed` |
| 6 | RLS for `godown` (select approved/ready_to_bill LG orders + items + scans) |

## Middleware / routing
- `ROLE_HOME` gains `godown → /godown`; wrong-territory rules extend so godown can't reach `/` or `/dashboard`, and staff can't reach `/godown`.

## Open / to validate before/at build
- ~~More barcode samples~~ ✅ **Done** — serial format `\d{3}[A-Z]{4}\d{6}` confirmed across 5 categories; regex extraction locked in.
- ~~Cancel → free serials~~ ✅ **Resolved (2026-07-10)** — moot: uniqueness is within-bill only now; cancelled bills keep their scans.
- **Model-verify (optional, later):** also scan the model barcode to guard against picking the wrong box.
- **Scan library:** `@zxing/browser` (QR + linear barcodes, iOS Safari + Android) with native `BarcodeDetector` as a fast path; camera needs HTTPS (✓ on Vercel). Note LG's serial barcode is a **linear/1D barcode** (per the box photos), so the reader must handle Code128/Code39-style symbologies, not just QR.
