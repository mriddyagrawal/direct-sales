# Builder prompt — Scanning for everyone: expose the scan screen to admin / accountant / salesman

Today only the **godown** role can scan an approved LG order's serials. Open that
up: **admin, accountant, and salesman can all scan**, from a **Scan** button on the
order-detail screen of an `approved` LG order. This is the bigger of the two —
backend (RPC + guard) + a new route + the button placement. Nothing about the
godown app changes. Design context: [docs/godown-fulfilment-design.md](../docs/godown-fulfilment-design.md),
[docs/specs/orders-ui.md](../docs/specs/orders-ui.md).

## Where the Scan button goes (owner spec)
The Scan button appears **only on `approved` orders** (only LG ever reaches
`approved` — fixed brands skip straight to `ready_to_bill`), for **every** role.
Style: **white background** (`secondary` variant), a **barcode glyph** (lucide
`scan-barcode`), label **"Scan"**. It navigates to the scan screen for that order.

- **Admin & accountant** (approved detail): today the wide blue **Mark billed**
  override sits above the secondaries. **Split it in half** — a half-width
  **Mark billed** (blue) beside a half-width **Scan** (white). Keep the
  "Waiting for the godown to scan serials." line above them.
- **Salesman** (approved detail): today the lone **Share** fills the secondaries
  row. **Split it in half** — **Share** beside **Scan**.

(Add a `.splitRow` style — flex, 8px gap, each child `flex: 1` — for the staff
Mark-billed | Scan pairing; the salesman's secondaries row already splits equally,
so adding Scan yields Share | Scan.)

## 1. Migration (14-digit `YYYYMMDDHHMMSS`, no `T`; apply via MCP; reconcile the repo filename)
Two function bodies change; **no data backfill, no new columns, no RLS change.**

- **`submit_pick`** — relax the role gate, keep every other guard. Replace
  `if v_role <> 'godown' then raise 'only godown may submit a pick'; end if;` with:
  **any active profile may scan** (the `v_role is null` check already rejects
  inactive/no-profile). Then, **after** the order is fetched `FOR UPDATE`, add a
  **salesman-ownership scope** (defense-in-depth — `submit_pick` is
  `SECURITY DEFINER`, so it bypasses RLS): `if v_role = 'salesman' and v_order.salesman_id <> v_caller then raise exception 'you can only scan your own orders'; end if;`
  **Leave everything else byte-identical**: the `approved` status assert, the
  `requires_scan` (LG) check, the "no scan references a foreign line" check, the
  full per-line **coverage** check, the **within-bill dedup**, the **server-side
  serial extraction** (`substring(raw from '[0-9]{3}[A-Z]{4}[0-9]{6}')`), the
  `approved → ready_to_bill` transition, `picked_at/by = caller`, and the `picked`
  event.
- **`guard_order_transition`** — the `approved → ready_to_bill` branch currently
  requires `auth_profile_role() = 'godown'` and would reject a salesman/admin
  calling `submit_pick`. **Remove that role check** for the `old.status='approved'
  → new.status='ready_to_bill'` edge (just `return new`) — `submit_pick` is now the
  gatekeeper. **Keep untouched**: admin-only `→ approved`; admin-only
  `pending_approval → ready_to_bill` (the fixed-brand approval path); and every
  cancel/bill edge.
- **Regenerate** `src/lib/types/database.types.ts` (signatures are unchanged, but
  regenerate per protocol).
- **No `order_item_scans` RLS change**: INSERT rides the `SECURITY DEFINER` RPC;
  SELECT already covers staff, godown, **and salesman-own** (shipped `d97587a`), so
  every scanning role can read the serials of orders it can see.

## 2. New universal scan route — `/scan/[id]`
Mirror the godown pick shell but for **any** authenticated role.
- **`src/app/scan/[id]/page.tsx`** — server shell modelled on
  [src/app/godown/[id]/page.tsx](../src/app/godown/[id]/page.tsx), **minus** the
  `profile.role !== 'godown'` redirect. Gate = authenticated + active (middleware
  already handles that). Fetch the order (**RLS scopes it** — salesman sees only
  his own, staff see all); **redirect to the order detail if the order is missing
  or not `approved`**. Select the **same price-free columns** the godown page does
  (`id, order_ref, status, retailers(name, area), brands(show_model), order_items(id, product_name, qty, position, products(tally_name))`)
  — do **not** add price columns. Render `<PickScreen … />`.
- **`PickScreen`** currently hardcodes `router.push("/godown")` after submit and a
  back `Link href="/godown"`. Parameterise both with a **`doneHref` prop**
  (default `"/godown"` so the godown flow is unchanged). `/scan/[id]` passes the
  caller's order-detail path — **`/dashboard/orders/{id}` for staff,
  `/orders/{id}` for salesman** (the page already reads the profile role; use it
  to pick the base). After a successful pick the user lands back on the order
  detail (now `ready_to_bill`).
- **Middleware:** `/scan/[id]` needs **no new allow-rule** — the fences today block
  salesman from `/dashboard`+`/godown` and staff from `/`+`/godown`; `/scan` is in
  neither set, so both already pass. **Verify** the `middleware.ts` matcher covers
  `/scan` (it should, via the broad matcher) and that a salesman + an accountant
  can both load `/scan/<approved-id>`. Godown stays fenced to `/godown` (it uses
  its own queue; it won't and needn't hit `/scan`).

## 3. The Scan button (`src/components/orders/OrderDetailView.tsx`)
- Gate: `order.status === 'approved'` (implies LG). Renders for **all** roles.
- `onClick`: `router.push(`/scan/${order.id}`)`. Style: `variant="secondary"`,
  `<Glyph icon={ScanBarcode} />` + `Scan`.
- Staff: wrap the existing approved-override **Mark billed** and the new **Scan**
  in the `.splitRow`. Salesman: add **Scan** into the secondaries beside **Share**.
- Import the glyph from `lucide-react`; add it to the glyph table in
  [docs/specs/orders-ui.md](../docs/specs/orders-ui.md) (Scan → `scan-barcode`).

## Commit sequence (atomic)
1. Migration: `submit_pick` role-relax + salesman-own scope; `guard` approved→
   ready_to_bill role-relax; regenerate types.
2. `PickScreen` `doneHref` prop (default `/godown`, godown behaviour unchanged).
3. `/scan/[id]` route (server shell, no godown gate, approved-only, price-free).
4. Scan button on the approved detail — staff split Mark billed|Scan, salesman
   split Share|Scan; `.splitRow` CSS; glyph.
5. Docs: update `docs/godown-fulfilment-design.md` (scanning is no longer
   godown-only — any role, salesman scoped to own; guard/RPC notes) +
   `docs/specs/orders-ui.md` (the Scan button + glyph).

## Acceptance (reviewer verifies by execution — live, rolled back)
- **Salesman** can scan **his own** approved LG order: Scan → `/scan/{id}` →
  submit → `ready_to_bill`, lands back on `/orders/{id}`. He **cannot** scan
  another salesman's order — `/scan/{id}` redirects (RLS: no row), and a **direct
  `submit_pick` on a foreign order raises** "you can only scan your own orders".
- **Admin** and **accountant** can scan **any** approved LG order via the split
  Mark billed | Scan button; submit → `ready_to_bill`.
- **All other `submit_pick` guards still hold** (prove by execution): non-`approved`
  rejected, non-`requires_scan` brand rejected, incomplete coverage rejected,
  a serial scanned twice in one batch rejected, serials still derived server-side.
- **Godown unchanged**: the `/godown` queue + `/godown/[id]` pick still work end to
  end (default `doneHref`), still price-free.
- **Scan button visibility**: shows on `approved` only — absent on
  pending_approval / ready_to_bill / billed / cancelled, for every role.
- `npm run build` + `tsc` + eslint clean; migration filename reconciled.

## Guardrails
- **Only** the role gate changes in `submit_pick` (+ the salesman-own scope) and
  **only** the `approved → ready_to_bill` role check in the guard. Every other
  guard/edge/serial rule stays exactly as-is.
- **No `order_item_scans` RLS change**, no new columns, no price columns on the
  scan screen (prices never reach the scanner).
- Salesman is scoped to **his own** orders in `submit_pick` even though RLS already
  hides others — the RPC is `SECURITY DEFINER`, so belt-and-suspenders.
- `PickScreen`'s default behaviour (godown) must be untouched — the `doneHref`
  defaults to `/godown`.
- Watch-item for the reviewer: confirm a salesman can read `products.tally_name`
  for the model line on `/scan` (non-fatal if not — `showModel` degrades), and that
  the `middleware.ts` matcher includes `/scan`.
