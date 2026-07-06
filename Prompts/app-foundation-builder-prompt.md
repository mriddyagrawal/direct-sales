# BUILDER PROMPT — App foundation + Auth (Next.js on the finished backend)

You are the **BUILDER** for `direct-sales` (Ganpati Enterprises B2B order-capture: Next.js + Supabase + Vercel). The **entire Postgres backend is done and reviewer-verified** — 7 tables, 4 order RPCs, triggers, the full RLS matrix, provisioning, and the Zebronics seed (42 products) are live on the Supabase project. Your milestone now is the **application foundation**: scaffold the Next.js app, wire Supabase auth, build the design system, and stand up **role-gated shells that read real RLS-scoped data**. This bridges PLAN's M1 (app half) and M3 (auth).

**This is deliberately not the feature screens.** Quick Order (S4), Review (S5), order detail/workbench (S7/S9), pick slip (S10), and retailer verification (S11) — and all the *write* RPC flows — are the next milestones (M4/M5). Do not build them here. Build the skeleton they'll hang on.

Work in small atomic commits on branch **`feature/app-foundation`**. A separate REVIEWER verifies every commit by execution and appends blocks to `comments.md`; read the newest ones before each commit, fix any 🔴 blocking issue in the very next commit, never edit the reviewer's blocks. Commit messages must be **literally accurate**.

---

## 0. The finished backend you are building against

- **Project:** `ugjwcbxyyuowiyhczcrh` (Supabase, ap-south-1/Mumbai, PG17), managed **via the Supabase MCP** — no local Docker/CLI DB. API URL: `https://ugjwcbxyyuowiyhczcrh.supabase.co`.
- **Client key:** fetch the **publishable** key (format `sb_publishable_…`, recommended over the legacy `anon` JWT) via MCP `get_publishable_keys` or the dashboard. It ships in the client — that is safe; **RLS is the wall**. The `service_role`/secret key is server-only, never in a client bundle, never committed.
- **Auth model (D3):** email + password, **admin-created, no self-signup**. A trigger provisions every new `auth.users` row as a `salesman` `profiles` row; staff roles are promoted in Studio. `profiles.active = false` = deactivated (must lose all access).
- **Role helper:** `public.auth_profile_role()` returns the caller's role (`admin`/`accountant`/`salesman`) or **NULL when inactive/absent** — fail-closed. Use it (or a `profiles` select) for UI gating, but remember gating is cosmetic: **RLS enforces the truth**.
- **Order RPCs (for M4/M5, not this milestone):** `submit_order(p_id uuid, p_retailer_id uuid, p_notes text, p_items jsonb)`, `update_order_items(p_order_id uuid, p_notes text, p_items jsonb)`, `cancel_order(p_order_id uuid, p_reason text)`, `process_order(p_order_id uuid)`. Listed so you wire types/helpers with the right names; do not call the writes yet.
- **Test accounts** (real, on the live project — see [docs/m1-test-accounts.md](docs/m1-test-accounts.md)): `kumarvikramagrawal@gmail.com` = admin, `mriddyagrawal@gmail.com` = accountant, `mridul289agrawal@gmail.com` = salesman. Passwords are with Mridul (never in the repo) — ask him to sign in for manual verification.

## 1. Source of truth — conform exactly

- **[design/phase1-design-spec.md](design/phase1-design-spec.md)** — the "instrument" grammar: tokens (color, type scale, layout constants), the status-tag system, buttons, and screens **S1–S11**. This milestone implements **S1 (Login)** fully and the **shells** of S2 (salesman Home) and S8 (desktop Orders list); everything else is reference for the design system only.
- **[docs/specs/roles-and-permissions.md](docs/specs/roles-and-permissions.md)** — RLS matrix + provisioning runbook (what each role may read).
- **[docs/specs/salesman-app.md](docs/specs/salesman-app.md)** / **[docs/specs/accountant-dashboard.md](docs/specs/accountant-dashboard.md)** — app behavior specs (build only the shell parts now).
- **[docs/specs/order-lifecycle.md](docs/specs/order-lifecycle.md)** — drafts are **client-side only** (localStorage), never DB rows; "locked" is derived. Keep this in mind when you shape state, even though the cart flow is M4.
- **[PLAN.md](PLAN.md)** in-phase choices: Tailwind vs vanilla CSS (**your call** — but the design tokens must live in **one** place and match the spec), Realtime vs polling (defer — a plain fetch is fine now), PWA add-to-home (M4; but do ship the favicon/app-icon now).

## 2. Deliverables (ordered; one atomic commit per numbered item unless noted)

1. **Next.js scaffold.** App Router, **TypeScript**, ESLint, `src/app`. Node/`package.json` at repo root. `.gitignore` already covers `.next/`, `node_modules/`, `.env*` (allow-listing `.env.example`) — verify it does. App builds and runs (`npm run dev`, `npm run build`).
2. **Supabase integration via `@supabase/ssr`** (not the deprecated `auth-helpers`): a browser client (`createBrowserClient`), a server client (`createServerClient` with the Next cookies adapter), and **middleware** that refreshes the session on every request. In server code make auth decisions with **`supabase.auth.getUser()`** (validates against the Auth server) — never `getSession()` for gating.
3. **Env + secrets.** `.env.local` (gitignored) with `NEXT_PUBLIC_SUPABASE_URL` and the publishable key (`NEXT_PUBLIC_SUPABASE_ANON_KEY` or `…PUBLISHABLE_KEY` — pick one name and use it consistently). Commit a `.env.example` with the keys blank/placeholder. **No real keys in git.**
4. **Design system foundation.**
   - **Fonts:** Space Grotesk (structure) + JetBrains Mono (**every figure** — refs/SKUs/prices/qty/times). Per the spec's font mandate: **subset both, `font-display: swap`, declare system fallback stacks** (`system-ui` for structure; `ui-monospace, Menlo, Consolas, monospace` for figures) so first paint never waits on webfonts (the <2s-on-4G budget outranks typography). Prefer `next/font` (local or Google) for self-hosting + subsetting.
   - **Tokens as one source:** the color table (accent `#1D4ED8`, amber `#B45309`, locked `#6B7580`, processed `#15803D`, error `#B91C1C`, ink `#14181F`, paper `#F2F3F5`, inactive `#8A94A0`) and the type scale, encoded once (CSS variables or Tailwind theme). **2px radius everywhere, hairline rules, no shadows, no gradients.** Light theme only.
   - **Primitives:** `Button` (filled-accent primary / hairline-outline secondary / red-outline destructive / ink Print — **one filled-accent element per view max**), `StatusTag` (flat rect + leading 8px status square + mono text, per the spec's status vocabulary), `Field` (white, 1px hairline, 2px radius, 1px-accent sharp focus, red-edge error + plain-words helper). These are the shared vocabulary both apps reuse.
   - **App mark:** the **receipt-glyph** favicon ([assets/favicon.png](assets/favicon.png)) is the icon everywhere — favicon, the S1 login block (ink or accent per context), and a padded **maskable** variant for Android. This overrides any GE-monogram.
5. **S1 · Login (full).** Sign-in **only** (no signup, no in-app reset — footer reads *"Forgot password? Call the office to reset it."*). Email/password with SHOW toggle, "Keep me signed in — ~30 DAYS ON THIS PHONE" checked by default, full-width accent Sign in with an inline spinner in the accent block on submit. Errors (wrong credentials, **deactivated account**) render as flat red-edged strips. On success, route by role.
6. **Route protection + role routing.** Middleware: unauthenticated → `/login`; authenticated hitting `/login` → their role home. A signed-in user whose `auth_profile_role()` is **NULL (deactivated)** must be denied and signed out (not shown an app shell). Role homes: **salesman → mobile Home** (S2 shell); **accountant/admin → desktop Orders** (S8 shell).
7. **Role shells that prove RLS from the browser** (thin, real data — this is the milestone's verifiable payoff):
   - **Salesman Home (S2 shell):** the bottom tab bar (**Home + New Order only**, 70px, hairline top, New Order = solid accent block, active = ink icon + 2px accent top-rule), the `TODAY · 06 JUL` / `EARLIER` section labels, order **cards** (mono ref + mono total on top, shop + item count, `StatusTag`), and the **empty state** ("No orders yet — take your first order — tap New Order below"; New Order stays tappable). Read the salesman's own orders via the RLS-scoped client. "Signed in as … · Sign out" at the bottom of Home. (New Order can route to a placeholder — the cart flow is M4.)
   - **Accountant/admin Orders (S8 shell):** top chrome (receipt mark + GANPATI ENTERPRISES, Orders/Retailers tabs), the ledger **table** header (REF · SUBMITTED · SALESMAN · RETAILER · LINES · TOTAL · STATUS) with 2px ink underrule and 40px hairline rows, reading **all** orders via the RLS-scoped client. Loading = skeleton, never a spinner. Live-flash/Realtime and the filters/keyboard-nav are M5 — a static fetch + a couple of seeded rows is enough to prove the read path.
8. **Sign-out** everywhere it belongs (salesman: bottom of Home; accountant: top chrome).

## 3. Acceptance criteria — this milestone is done when

- `npm run build` succeeds; `npm run dev` serves the app.
- Signing in as each of the **3 test accounts** from the browser lands on the **correct role home** and shows **only RLS-permitted data** (salesman sees only their own orders; accountant/admin see all). Verify against the live project.
- Unauthenticated access to any app route redirects to `/login`; a signed-in user on `/login` is bounced to their home.
- A **deactivated** account (`profiles.active=false`) cannot reach any shell (sign it out / deny) — test by flipping `active` on a throwaway account via MCP and back.
- Fonts and tokens **match the spec** (Space Grotesk + JetBrains Mono with fallbacks; the exact hexes; 2px corners; hairlines; no shadows). The receipt-glyph favicon/app-icon is wired.
- No secret keys in git; `.env.example` present; publishable key only in `.env.local`.
- **Hand the REVIEWER a test path:** they log in as each role and check the above. Point them at [docs/m1-test-accounts.md](docs/m1-test-accounts.md); passwords come from Mridul.

## 4. Notes carried forward

- **Enable leaked-password protection** (Supabase Auth → HaveIBeenPwned check) — it's an open security-advisor WARN; flip it on as part of standing up auth (or record it as an owner go-live toggle if you can't from MCP).
- Keep the **future Payments tab** slot grammar in the tab bar (owner decision) but render only Home + New Order.
- The drift-protected `scripts/seed.ts` loader (ledger ⑬) can now actually be built since Node exists — but it's optional here; the catalog is already seeded. Do it only if convenient, else leave it flagged for M4.

## 5. Do NOT

- Build the Quick Order / Review / order-detail / pick-slip / verification screens or call the write RPCs (`submit_order` etc.) — those are M4/M5.
- Use the deprecated `@supabase/auth-helpers-nextjs` (use `@supabase/ssr`), or `getSession()` for server-side gating (use `getUser()`).
- Add self-signup or an in-app password-reset flow (D3: admin-created accounts only).
- Put any secret key in the client bundle or the repo; hardcode tokens in more than one place; use shadows/gradients/rounded cards (the grammar is hairlines + 2px).
- Trust `auth_profile_role()` for security (it's UI convenience) — RLS is the wall.
- Start a local Supabase/Docker stack, or edit the reviewer's blocks in `comments.md`.
