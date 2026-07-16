# Builder prompt — Tally stock sync (extractor → import → salesman display)

**Owner:** Mridul · **Written by the REVIEWER, 2026-07-16** · grounded against live code + the prod DB (`ugjwcbxyyuowiyhczcrh`).

## The goal, in one line
Get **current stock quantities out of Tally** (on a Windows VPS), **into the web app** (admin uploads a file on the Products page, matched to products by Tally name), and **shown to salesmen** on each product in Quick Order — so they know what's actually in the godown before they sell it.

Build in **four phases, in order.** T1 stands alone. **T2 is a prod DB migration — do NOT apply it until the owner explicitly approves** (two additive nullable columns + one RPC; safe, but the owner signs off on every DB change). T3/T4 depend on T2.

Owner decisions already locked (do not re-litigate):
- Extractor = **Python + double-click `.bat`**, stdlib-only (no `pip install`), runs on the Tally VPS. **Strictly READ-ONLY to Tally** — it only ever sends *Export* requests; it never writes, creates, or alters anything in Tally.
- Import can **only update existing products** — it never creates an item and never edits name/category/price. An unmatched Tally name is reported, full stop.
- Import = a **separate "Update stock" button** on the Products page — never touches price/name/category, never creates products.
- Salesman display = **two-state pill (🟢 in stock + count / 🔴 out of stock) + "as of <date>"** — no amber "Low" tier (owner 2026-07-16).
- Out-of-stock = **allow the order, show a "will backorder" warning** (never block — the backorder flow already exists).
- Match **globally on `tally_name`** (one Tally company holds all brands; the file has no brand column).
- Unmatched Tally names = **report only** (a stock row can't supply name/category/price, so it can't create a product).

---

## Current state (verified — build against this, not assumptions)

- **`products`** columns: `id, brand_id, category(NN), name(NN), price_paise(null), active(NN), tally_name(NN), created_at, updated_at`. **No stock column yet.** Key: `unique(brand_id, tally_name)`. Money in **integer paise**; stock is a **plain integer count** (not money).
- **`import_products(p_brand_id uuid, p_rows jsonb)`** — [supabase/migrations/20260707154808_import_products.sql](../supabase/migrations/20260707154808_import_products.sql): `security definer`, `set search_path = public, pg_temp`, admin re-check (`auth_profile_role() <> 'admin'` → raise), atomic loop, `xmax = 0` added/updated split, returns `jsonb_build_object('added',…, 'updated',…)`, `grant execute … to authenticated`. **Mirror this shape for `import_stock`.**
- **Import UI** — [src/app/dashboard/products/ImportWizard.tsx](../src/app/dashboard/products/ImportWizard.tsx): client-side parse with `xlsx` (SheetJS) → diff against current catalog → **Upload → Preview → Applying → Result → Unreadable** steps → `import_products` RPC. `XLSX.read(buf, {type:'array'})` **already parses CSV as well as .xlsx** — reuse it.
- **Import button** — [src/app/dashboard/products/ProductsPricing.tsx:177-182](../src/app/dashboard/products/ProductsPricing.tsx#L177): inside `{isAdmin && ( … )}`, a secondary **Import** button (`setImporting(true)`) beside **Add**; `<ImportWizard>` rendered at the bottom. Put the new **Update stock** button + `<StockImportWizard>` right alongside, same admin gate.
- **Salesman product shape** — `ProductOption` at [src/app/new-order/page.tsx:5](../src/app/new-order/page.tsx#L5): `{ id, category, name, tally_name, price_paise|null, brand_id, pricing_mode, show_model }`. Built from the query at [page.tsx:77](../src/app/new-order/page.tsx#L77): `.select("id, category, name, tally_name, price_paise, brand_id, brands(name, pricing_mode, show_model)")`. **Add `stock_qty, stock_updated_at` to both.**
- **Salesman card** — [src/app/new-order/QuickOrder.tsx](../src/app/new-order/QuickOrder.tsx), the per-product render (~L197+): name, price label, expandable price field. The stock pill goes here.
- **Helpers:** `formatRupees` in [src/lib/format.ts:109](../src/lib/format.ts#L109) (IST-based date formatters live in the same file); `normalizeCategory`/`effectiveTallyName` in [src/lib/catalog.ts](../src/lib/catalog.ts); `Button` in `@/components/ui/Button`.
- **Prod caution:** app + DB are LIVE. Branch off `main`. Get owner approval before applying **any** migration. Confirm each non-DB commit is DB-free.

---

## Phase T1 — Windows extractor (`tally-agent/`, standalone, no DB, no app)

> **🔒 READ-ONLY GUARANTEE (hard requirement).** This script must only ever *read* from Tally. Tally's HTTP-XML gateway separates `<TALLYREQUEST>Export</TALLYREQUEST>` (reads data OUT — structurally cannot modify Tally) from `Import`/`Execute` (writes). The script sends **only Export/Collection requests** and must **never** contain `Import`, `Alter`, `Create`, `<IMPORTDATA>`, a `<TALLYMESSAGE>` voucher/master payload, or any write verb — not even commented-out sample code. State this in a comment at the top of the `.py` and plainly in the README. (Standard Tally has no per-request read-only login, so the safety comes from the request *type*, not a Tally-side permission — which is exactly why the script must never build a write envelope.)

New top-level folder **`tally-agent/`** (outside `src/` — Next won't compile it). Files:

### `tally-agent/stock_export.py` — **Python 3, standard library only** (`urllib.request`, `xml.etree.ElementTree`, `csv`, `os`, `datetime`, `re`). No `pip install`.

Behavior:
1. **Config constants at the very top**, clearly commented for the owner to edit:
   - `TALLY_URL = "http://localhost:9000"`
   - `OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "GanpatiStock")`
2. **Ensure `OUTPUT_DIR` exists** (`os.makedirs(OUTPUT_DIR, exist_ok=True)`) — creates it on first run, reuses it after.
3. **POST the Tally XML request** to `TALLY_URL` (Content-Type `text/xml`, ~15s timeout). Use a **Collection export of `StockItem`** fetching `Name` + `ClosingBalance`:
   ```xml
   <ENVELOPE>
     <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>StockSummary</ID></HEADER>
     <BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
       <TDL><TDLMESSAGE>
         <COLLECTION NAME="StockSummary" ISMODIFY="No"><TYPE>StockItem</TYPE>
           <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>ClosingBalance</NATIVEMETHOD></COLLECTION>
       </TDLMESSAGE></TDL>
     </DESC></BODY>
   </ENVELOPE>
   ```
   Parse `<STOCKITEM>` elements → `NAME` (attribute or child, whichever the response uses — handle both) + `CLOSINGBALANCE`.
4. **Parse the quantity** from `ClosingBalance` (Tally returns e.g. `" 12.00 Nos"`, `"-3 Nos"`, `"1,234 Nos"`): strip commas, take the leading signed number via regex `-?\d+(\.\d+)?`, round to an **int**. Include zeros (0 = out of stock). Skip an item only if the name is blank or the balance has no parseable number (count skips, print the count).
5. **Write a NEW timestamped CSV** into `OUTPUT_DIR`: filename `stock_YYYY-MM-DD_HHMM.csv` (local time, `datetime.now()`), header row **`Tally Name,Stock`**, one row per item. Never overwrite — every run is a fresh file (keeps history).
6. **Print** the full output path, item count, and skip count. On success end with a friendly line so the operator knows what to upload.
7. **Error handling with plain-English messages** (not tracebacks): connection refused / timeout → `"Could not reach Tally at http://localhost:9000 — is TallyPrime open with the company loaded and the XML server (port 9000) enabled? See README."`; empty item list → `"Connected, but Tally returned 0 stock items — check the company is loaded."` Wrap `main()` so any exception prints a clean message.

### `tally-agent/run-stock-export.bat`
```bat
@echo off
python "%~dp0stock_export.py"
if errorlevel 1 echo(&echo Something went wrong - see the message above.
echo(
pause
```
(`pause` keeps the window open on double-click. If `python` isn't found, the README covers install.)

### `tally-agent/README.md` — the operator runbook (write it for a non-technical user)
- **One-time setup:** (1) Install Python 3 from python.org — **tick "Add python.exe to PATH"**. (2) In TallyPrime enable the XML server: *Help ▸ Settings ▸ Connectivity ▸ Client/Server configuration ▸* set **TallyPrime acts as: Server**, **Port: 9000**; keep the company open. (Tally.ERP9 equivalent: *Gateway ▸ F1: Help ▸ Advanced Config*.)
- **Every time:** RDP into the VPS → open Tally + load the company → **double-click `run-stock-export.bat`** → note the printed path (`…\Desktop\GanpatiStock\stock_<date>_<time>.csv`) → open the app on your phone/laptop → **Products ▸ Update stock ▸** upload that file → confirm.
- **Troubleshooting:** the "could not reach Tally" and "0 items" cases, and a note that if the Collection export returns empty on their Tally version, the fallback is a **Stock Summary report export** (leave a commented alternate request block in the .py for this).
- Include a tiny **`tally-agent/sample-stock.csv`** (`Tally Name,Stock` + 2 example rows) so the web side has a fixture to test against.

**T1 acceptance:** folder created on run; a fresh timestamped `Tally Name,Stock` CSV each run; zeros included; clean error message when Tally is unreachable (test by running with Tally closed). Commit: `feat(tally-agent): Windows stock extractor (stdlib Python + .bat + runbook)`.

---

## Phase T2 — DB: stock columns + `import_stock` RPC  ⚠️ OWNER-APPROVAL-GATED

One migration (name `YYYYMMDDHHMMSS_stock_sync.sql`; apply via MCP `apply_migration`, then reconcile the filename to the ledger). **Do not apply until the owner says go.**

```sql
alter table public.products add column stock_qty integer;          -- null = never synced
alter table public.products add column stock_updated_at timestamptz; -- per-row "as of"

create or replace function public.import_stock(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role text := public.auth_profile_role();
  v_row jsonb; v_name text; v_qty integer; v_hit integer;
  v_matched integer := 0; v_unmatched jsonb := '[]'::jsonb; v_now timestamptz := now();
begin
  if v_role is null then raise exception 'not an active profile'; end if;
  if v_role <> 'admin' then raise exception 'only admin may import stock'; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_name := btrim(v_row->>'tally_name');
    if v_name is null or v_name = '' then continue; end if;
    if (v_row->>'stock_qty') !~ '^-?[0-9]+$' then continue; end if;   -- skip non-integer
    v_qty := (v_row->>'stock_qty')::integer;
    update public.products
       set stock_qty = v_qty, stock_updated_at = v_now
     where lower(btrim(tally_name)) = lower(v_name);                  -- global, case-insensitive
    get diagnostics v_hit = row_count;
    if v_hit > 0 then v_matched := v_matched + v_hit;
    else v_unmatched := v_unmatched || to_jsonb(v_name); end if;
  end loop;
  return jsonb_build_object('matched', v_matched, 'unmatched', v_unmatched);
end; $$;

grant execute on function public.import_stock(jsonb) to authenticated;
```

Notes: match **globally** on `tally_name` (NOT brand-scoped — unlike `import_products`); update **only** `stock_qty` + `stock_updated_at` (leave `updated_at`/price/name/category/active alone — stock sync is a separate axis from a catalog edit); atomic (all-or-nothing); idempotent (re-run = same result); never inserts, never deletes. No RLS change needed (salesman SELECT already covers new columns).

**T2 acceptance (verify by execution, rolled back where it writes):** admin `import_stock` updates matched rows' `stock_qty`+`stock_updated_at`, returns `{matched, unmatched:[…]}`; a bogus tally_name lands in `unmatched`; non-admin (accountant/salesman) → raises "only admin may import stock"; non-integer qty skipped; re-run idempotent. Commit: `feat(db): stock_qty/stock_updated_at + import_stock RPC (admin-only, match on tally_name)`.

---

## Phase T3 — Web: "Update stock" button + `StockImportWizard` (+ Stock column on the list)

- **`src/app/dashboard/products/StockImportWizard.tsx`** — model it on `ImportWizard.tsx` (same scrim/panel/steps/CSS — reuse `ImportWizard.module.css` classes or a sibling module). Differences:
  - **No brand picker** (stock is global). Accept **`.csv` and `.xlsx`** (`accept=".csv,.xlsx,…"`; `XLSX.read` handles both).
  - Recognize headers flexibly: tally-name column ∈ {`tally name`,`tally_name`,`name`,`item`}; stock column ∈ {`stock`,`stock_qty`,`qty`,`quantity`,`closing`,`closing balance`}. If neither pair is found → `unreadable`.
  - **Preview** diffs against **all** products (`select id, tally_name, name, stock_qty`, no brand filter), keyed on `lower(trim(tally_name))`. Show: **Matched · N** (with old→new per row: `12 → 8`), **Not found · M** (list the unmatched Tally names — these are skipped), and skip any row whose stock isn't an integer. Header/columns: `TALLY NAME · CURRENT · NEW`.
  - **Apply** calls `supabase.rpc("import_stock", { p_rows })` with `[{tally_name, stock_qty}]` (integers). Result step shows `matched` updated + `unmatched.length` not-found; list the not-found names so the owner can fix the catalog.
  - Heading "**Update stock**"; download-template button optional (a 2-col `Tally Name,Stock` sample).
- **`ProductsPricing.tsx`:** add a secondary **Update stock** button inside the existing `{isAdmin && (…)}` block beside **Import** (new `stockImporting` state), and render `<StockImportWizard onClose … onDone={refresh} />` alongside `<ImportWizard>`.
- **Stock column on the pricing table:** show `stock_qty` (or `—` when null) so the admin can confirm the import landed; a muted "as of <date>" from `stock_updated_at` is a nice touch. (Add `stock_qty, stock_updated_at` to whatever query feeds this page.)

**T3 acceptance:** admin uploads `tally-agent/sample-stock.csv` → preview shows matched/not-found correctly → apply → numbers land on the products list; a non-admin never sees the button (and the RPC would reject anyway). tsc/eslint/build clean. Commit: `feat(products): Update-stock import (match on tally name, stock-only) + stock column`.

---

## Phase T4 — Salesman: stock pill on the Quick Order card

- Add `stock_qty: number | null` + `stock_updated_at: string | null` to `ProductOption` and to the `.select(…)` at [page.tsx:77](../src/app/new-order/page.tsx#L77) (`… , stock_qty, stock_updated_at, brands(…)`), and map them through.
- In **QuickOrder.tsx**, render a **stock pill** on each product card (near name/price). **Two states only — no amber/"Low" tier, no threshold (owner 2026-07-16):**
  - `stock_qty > 0` → 🟢 **In stock · {n}**
  - `stock_qty === 0` → 🔴 **Out of stock** + muted sub-note **"will backorder"**
  - `stock_qty === null` → render **nothing** (never synced)
  - Append **"as of {short date}"** from `stock_updated_at` (add a compact `formatShortDate(iso)` → e.g. `16 Jul`, IST, to `src/lib/format.ts`). Colors via CSS classes (semantic good/critical), not inline styles; readable in light + dark.
- **Out-of-stock = allow + warn, never block:** adding a 0-stock item to the cart must still work (backorder flow handles it). The 🔴 pill + "will backorder" IS the warning; optionally echo a small "⚠ will backorder" note on the cart line when `stock_qty === 0 && qty > 0`. Do **not** disable the stepper or the add button.

**T4 acceptance:** on a device/emulator, a synced in-stock product shows the green pill + count + as-of; a 0-stock product shows the red pill and can still be added (goes to cart, submits, backorders as before); never-synced products show no pill; light/dark both legible. tsc/eslint/build clean. Commit: `feat(new-order): stock pill on the Quick Order card (traffic-light + count + as-of, out-of-stock warns not blocks)`.

---

## Guardrails (all phases)
- Branch off `main`; small atomic commits; **T2 migration only after owner approval**; every non-DB commit must be DB-free.
- Read the newest `comments.md` review blocks before each commit; fix any ❌/blocking before new work.
- Commit messages must be literally accurate (the REVIEWER verifies by execution and flags drift).
- `stock_qty` is a **count**, never money — do not route it through `formatRupees`/paise.
- Don't regress the untamperable price rules, the order state machine, or RLS — this feature only **reads** stock on the salesman side and **writes** it admin-only.
