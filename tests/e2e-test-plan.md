# Direct-Sales — End-to-End Test Plan (for Antigravity browser agent)

Target: **https://direct-sales-nu.vercel.app** · App: B2B order capture for Ganpati Enterprises.
This plan is **role-phased and chained**: the salesman phase creates orders/retailers that the accountant and admin phases then act on. Run the phases **in order** within one session so the carry-forward values line up. Standalone tests (marked `[STANDALONE]`) can also be run on their own.

---

## 0. How to run this

1. You (the operator) provide the agent the **five accounts** below (username + password each). The app logs in by **username**, not email.
2. Pick one short **RUN TOKEN** per run, e.g. `QA4F7`. Every shop/user/product/note this plan creates must embed the token so created data is findable and never collides (e.g. shop `QA4F7-shop-1`, note `[QA4F7] zeb order`). This is how you locate "your own" rows in a shared production DB.
3. Work through **Phase 1 (Salesman) → Phase 2 (Accountant) → Phase 3 (Admin)**. Record the **carry-forward values** (order refs, retailer/user names) a test says to capture; later tests consume them.
4. For each test, report **PASS / FAIL**, the **observed** result vs **expected**, and a screenshot. Result schema for aggregation is at the bottom.

### Accounts (fill in before running)
| Ref | Role | Username | Password |
|---|---|---|---|
| **S1** | salesman | `mridul` | `vleviosa` |
| **S2** | salesman | `sitaram` | `sitaram$$$` |
| **ACC** | accountant | `mriddy` | `vleviosa` |
| **ADM** | admin | `vikram` | `kumarvikram` |

> There are 3 salesmen in the system; use any two as S1/S2. ACC and ADM are the single accountant and admin.

### Carry-forward ledger (the agent fills these as it goes)
| Var | Set in | Meaning |
|---|---|---|
| `REF_ZEB1` | SM-02 | Zebronics fixed order → **processed** by ACC (AC-07) |
| `REF_ZEB2` | SM-07 | Zebronics order kept **submitted** for the edit test |
| `REF_LG` | SM-05 | LG manual order → **pending approval** → approved+processed by ADM |
| `REF_LUM` | SM-06 | Luminous order placed against a **new (unverified)** retailer |
| `REF_CANCEL_OFFICE` | SM-02b | order the accountant will **office-cancel** (stays visible to salesman) |
| `NEW_SHOP` | SM-06 | `QA<token>-shop-1` — accountant verifies it (AC-11) |
| `REF_S2` | SM-10 | S2's order — must be **invisible** to S1 |
| `NEW_USER` | AD-06 | user the admin creates/edits/deactivates |

### Global truths & gotchas (apply to every test)
- **Money** is shown in **₹ with en-IN grouping** (e.g. `₹1,350`). Never expect raw paise.
- **Order statuses & chips:** `Submitted · <countdown>` (blue) → locks after the **2-hour** edit window (`Submitted · locked`); `Pending approval · <countdown>` (amber, LG/manual only); `Approved` (neutral); `Processed` (green); `Cancelled` (red).
- **Brands:** Zebronics + Luminous are **fixed-price**; **LG is manual-price** → its orders land in **pending approval** and need an **admin** to Approve before they can be processed.
- **Brand lock:** a cart locks to the **first item's brand**; you cannot mix brands in one order.
- **LG model prefix:** LG rows render `LG <model>・<display name>` (e.g. `LG 43UA73806LA・UHD TV 43"`). Zebronics/Luminous show the name only.
- **Realtime:** the accountant/admin Orders ledger receives new orders within **~5s** with no refresh (new rows briefly highlighted).
- **D8 self-cancel rule:** an order a **salesman cancels himself disappears** from his Home list; an order the **office cancels stays visible** to him (marked "by the office").
- **Web Share** on the pick slip is **mobile + HTTPS only** — present on a phone viewport on the deployed URL; may be hidden on desktop. Print works everywhere.
- Act **promptly** after submitting when a test needs an order still editable (2h window is generous but not infinite).

---

## Phase 1 — SALESMAN  (log in as **S1** unless a test says S2)

Salesman lands on **`/` (Home)**; the bottom bar has **Home** and **+ New Order**.

### SM-00 — Login + wrong-password `[STANDALONE]`
**Steps:** Go to the site → you should be at `/login`. Enter a **wrong** password for S1 → submit. Then enter the correct S1 credentials.
**Expected:** Wrong attempt shows **"Wrong username or password."** (never reveals which was wrong). Correct login lands on **Home (`/`)** with a bottom bar showing **Home / + New Order**, and "Signed in as <name>" + Sign out at the bottom.

### SM-01 — Home renders own orders `[CHAIN]`
**Steps:** Observe Home.
**Expected:** Either a list of the salesman's **own** orders (date section labels, each an order card with a status chip) or the empty state **"No orders yet — take your first order — tap New Order below."** No other salesman's orders appear here.

### SM-02 — Place a fixed-price order (Zebronics) `[CHAIN]`
**Steps:** Tap **+ New Order** → **Select retailer**: type a letter in Search, pick any existing shop from **ALL SHOPS**. On the **Quick Order** screen, if a brand dropdown is shown pick/搜索 **Zebronics**; add **2 different Zebronics products** (tap a row, set qty ≥1 via the stepper). Tap the sticky **Review ›** bar → **Review order**: add note **`[QA<token>] zeb1`** → tap **Submit order**.
**Expected:** **Confirmation** screen: "✓ ORDER SUBMITTED", an order ref like `ORD-…`, the retailer name + a ₹ total equal to the sum of lines, and a countdown chip. **Capture the ref → `REF_ZEB1`.** Tap **Back to Home** → the new order is at the top of Home with a **`Submitted · …`** chip.

### SM-02b — Place a second Zebronics order for the office-cancel chain `[CHAIN]`
**Steps:** Repeat SM-02 with note `[QA<token>] to-be-office-cancelled`, any retailer, 1 item.
**Expected:** Confirmation shown. **Capture ref → `REF_CANCEL_OFFICE`.** (Do **not** cancel it yourself — the accountant cancels it in AC-09.)

### SM-03 — Brand lock (cannot mix brands) `[STANDALONE]`
**Steps:** Start a new order, pick any retailer. Add **one Zebronics** item. Now try to switch to **LG** (via the brand dropdown or by searching an LG model).
**Expected:** The list stays scoped to **Zebronics**; a note reads **"Showing Zebronics — clear the cart to switch brands"** and the brand dropdown is locked. You **cannot** add an LG item until the cart is emptied. Abandon this draft (don't submit).

### SM-04 — Search + LG model prefix `[STANDALONE]`
**Steps:** In a fresh Quick Order (empty cart), search `TV`, then search an LG term (e.g. `UHD` or a model like `43UA`).
**Expected:** Search matches on **name, brand, and category**. **LG** rows render the **model to the left**: `LG <model>・<name>` with the model in a lighter shade. Zebronics/Luminous rows show the **name only** (no model prefix).

### SM-05 — Manual-price order (LG) → Pending approval `[CHAIN]`
**Steps:** New order → any retailer → add an **LG** product. The price line shows **"Tap to price"** — tap it, enter a **unit price** (e.g. `25000`) in the **Unit price** field, set qty `1`. Review (note `[QA<token>] lg`) → **Submit order** → on Confirmation tap **View order**.
**Expected:** Order submits; the detail chip is **"Pending approval · …"** (amber) and a line reads **"Waiting for office approval — you can still edit until the window closes."** The line total uses the price you typed. **Capture ref → `REF_LG`.**

### SM-06 — Quick-add a new retailer, order Luminous against it `[CHAIN]`
**Steps:** New order → **Select retailer** → search a nonsense string (e.g. `QA<token>zzz`) → tap **+ Add it as a new shop** (or the **+ Add new shop** button) → fill **Shop name** = `QA<token>-shop-1`, Area = `QA-area`, Phone = `9999900001` → **Add & start order**. Add a **Luminous** item, Review (note `[QA<token>] lum`), **Submit order**.
**Expected:** Order places against the just-created shop. **Capture:** `NEW_SHOP` = `QA<token>-shop-1`, ref → `REF_LUM`. The shop is saved as **NEW / unverified** (the office verifies it later in AC-11).

### SM-07 — Edit own order within the window `[CHAIN]`
**Steps:** Place a fresh Zebronics order (note `[QA<token>] zeb2`) → **capture ref → `REF_ZEB2`**. Open it → **Edit order** → increase a line's qty (or add one more item) → **Save changes**.
**Expected:** Returns to the order detail with the **updated total**; the **HISTORY** section logs an edit. Chip stays `Submitted · …`.

### SM-08 — Self-cancel disappears (D8) `[STANDALONE]`
**Steps:** Place a throwaway Zebronics order (note `[QA<token>] self-cancel`), open it → **Cancel order** → in the sheet confirm **Cancel order**.
**Expected:** After cancelling, return to **Home** — this order is **NOT** in the list (a self-cancelled order reads as "never happened"). Opening its URL directly still shows it as **Cancelled — by you**.

### SM-09 — Salesman cannot reach the dashboard `[STANDALONE]`
**Steps:** While logged in as S1, manually navigate to `/dashboard`, then `/dashboard/users`, then `/dashboard/products`.
**Expected:** Every one **redirects back to Home (`/`)** — a salesman has no dashboard access.

### SM-10 — Cross-salesman isolation (RLS) `[CHAIN]`
**Steps:** **Log out**, log in as **S2**, place any order (note `[QA<token>] s2`) → **capture ref → `REF_S2`**; confirm it shows on S2's Home. **Log out**, log back in as **S1**, view Home.
**Expected:** On S2's Home the order is visible; on **S1's Home `REF_S2` is absent**. A salesman sees only his own orders.

### SM-11 — Sign out `[STANDALONE]`
**Steps:** On Home, tap **Sign out**.
**Expected:** Returns to `/login`; visiting `/` afterwards redirects to `/login`.

---

## Phase 2 — ACCOUNTANT  (log in as **ACC**)

Accountant lands on **`/dashboard`** (Orders ledger). Nav rail: **Orders · Retailers · Products** (**no Users**).

### AC-00 — Login + landing `[STANDALONE]`
**Expected:** ACC login lands on **`/dashboard`** titled **Orders**. Rail shows exactly **Orders / Retailers / Products** — **no Users tab**.

### AC-01 — Staff sees every salesman's orders `[CHAIN]`
**Steps:** In the ledger, search each captured ref.
**Expected:** `REF_ZEB1`, `REF_LG`, `REF_LUM`, `REF_ZEB2`, `REF_S2` are all present — an accountant sees **all** salesmen's orders, including S2's (unlike the salesman view).

### AC-02 — Status tabs + counts `[CHAIN]`
**Steps:** Note the tab row: **All · Submitted · Pending approval · Processed · Cancelled**, each with a count. Click **Pending approval**, then **Submitted**.
**Expected:** **Pending approval** lists `REF_LG` (and any other manual orders); **Submitted** lists the fixed orders (`REF_ZEB1/2`, `REF_LUM`). Counts match the number of rows shown under each tab and respond to the other filters.

### AC-03 — Filters: salesman / brand / date / search `[STANDALONE]`
**Steps:** Set **Salesman = S1** → then **Brand = LG** → then type `REF_ZEB1` in search → then narrow the **date range** to exclude today.
**Expected:** Salesman filter shows only S1's rows; Brand=LG shows only LG orders; search reduces to the single matching ref; an out-of-range date makes the list empty. Filters **stack** (AND).

### AC-04 — Realtime new order `[STANDALONE, needs 2 sessions]`
**Steps:** Keep the ACC ledger open; in another browser/session have a salesman submit an order.
**Expected:** The new row appears at the top **within ~5s without refreshing**, briefly highlighted. (Skip/mark N/A if you can't run two sessions.)

### AC-05 — Open the workbench `[CHAIN]`
**Steps:** Click `REF_ZEB1`.
**Expected:** Workbench shows the ref, **"by <S1> · Zebronics · submitted …"**, a status chip, an **ITEM · SNAPSHOT AT SUBMIT** table (item/qty/rate/amount), the field notes, the retailer card, and a **HISTORY** list. Action buttons visible: **Mark processed · Edit · Cancel · Print pick slip**.

### AC-06 — Accountant **cannot** approve an LG order `[CHAIN]` ⭐ security
**Steps:** Open `REF_LG` (pending approval).
**Expected:** **No "Approve" button** (approval is admin-only) and **no "Mark processed"** (a manual order can't be processed until approved). Only **Edit / Cancel / Print pick slip** are available. This is a key permission boundary.

### AC-07 — Process a fixed order `[CHAIN]`
**Steps:** Open `REF_ZEB1` → **Mark processed** → confirm **Mark processed** in the sheet.
**Expected:** Status chip becomes **Processed** (green); the sheet warned "the salesman's app goes read-only." HISTORY logs it. (Verified from the salesman side in X-01.)

### AC-08 — Edit from the workbench (in-window, no reason) `[STANDALONE]`
**Steps:** Open a still-**Submitted** order (`REF_ZEB2`) → **Edit** → change a qty / add an item via "+ Add item" → **Save changes**.
**Expected:** Saves with **no reason required** (still inside the 2h window); total + HISTORY update. (If the window had passed it would demand a **REASON**.)

### AC-09 — Office-cancel with reason `[CHAIN]`
**Steps:** Open `REF_CANCEL_OFFICE` → **Cancel** → try to confirm with an **empty reason** (expect a validation error) → enter reason `[QA<token>] office cancel` → **Cancel order**.
**Expected:** Empty reason is blocked ("Reason is required."); with a reason the status becomes **Cancelled**. Because the **office** cancelled it, it will **stay visible** to the salesman (verified in X-03).

### AC-10 — Pick slip: prices toggle + print/share `[STANDALONE]`
**Steps:** Open any order → **Print pick slip** (opens a new tab). Observe **Prices off** (default), then toggle **Prices on**.
**Expected:** Prices **off** → badge **"PICK SLIP"**, columns **QTY / ITEM** only (no money). Prices **on** → badge **"ORDER COPY"**, adds **RATE / AMOUNT** columns and a **Total (incl. GST)** row. **Print** button always present; a **Share** button appears on a **mobile** viewport (native share sheet) and shares the same text respecting the toggle.

### AC-11 — Verify the new retailer `[CHAIN]`
**Steps:** **Retailers** → the **Pending** tab (has a count) → find `NEW_SHOP` (`QA<token>-shop-1`) → open its inline edit → **Save & verify**.
**Expected:** The shop moves from **Pending** to **Verified**; its **NEW** badge disappears from `REF_LUM` in the Orders ledger.

### AC-12 — Products (accountant scope) `[STANDALONE]`
**Steps:** **Products** → observe the toolbar; click a row to open the Edit modal; flip a row's **Active** toggle.
**Expected:** Accountant can **edit price / tally name / active** and toggle Active (flips instantly), but there is **no "+ Add product" and no "Import"** button (those are admin-only).

### AC-13 — Accountant **cannot** reach Users `[STANDALONE]` ⭐ security
**Steps:** Confirm no **Users** tab in the rail; manually navigate to `/dashboard/users`.
**Expected:** No Users tab; `/dashboard/users` **redirects to `/dashboard`**.

### AC-14 — Wrong-territory redirect `[STANDALONE]`
**Steps:** Navigate to `/` (the salesman home).
**Expected:** Redirects to **`/dashboard`** (staff can't use the salesman home).

---

## Phase 3 — ADMIN  (log in as **ADM**)

Admin lands on **`/dashboard`**; the rail additionally shows **Users**.

### AD-00 — Login + Users tab present `[STANDALONE]`
**Expected:** ADM login lands on `/dashboard`; rail shows **Orders / Retailers / Products / Users**.

### AD-01 — Approve the LG order, then process it `[CHAIN]` ⭐
**Steps:** Open `REF_LG` (pending approval) → an **Approve** button is present → click it. Then click **Mark processed** → confirm.
**Expected:** After Approve, chip → **Approved** and HISTORY logs "approved by <admin>". **Mark processed** then becomes available (it was hidden for the accountant in AC-06); processing sets chip → **Processed**. (Salesman side verified in X-02.)

### AD-02 — Reject-style cancel with reason `[STANDALONE]`
**Steps:** Pick any live order → **Cancel** → enter reason `[QA<token>] admin reject` → **Cancel order**.
**Expected:** Status → **Cancelled**; HISTORY shows the reason and actor.

### AD-03 — Products: admin add/edit/import `[STANDALONE]`
**Steps:** **Products** → **+ Add product** → create a product (Brand = Zebronics, Category `QA<token>-cat`, Display name `QA<token>-prod`, Tally name `QA<token>-TALLY`, Price `199`) → save. Open it → edit a field → save. Confirm an **Import** button exists.
**Expected:** New product appears in the catalog; edits persist; **+ Add product** and **Import** are both present for admin.

### AD-04 — Hard-delete is guarded `[STANDALONE]`
**Steps:** Open the Edit modal for a product that **has been ordered** (e.g. a Zebronics item used in `REF_ZEB1`) and attempt delete. Then delete the **never-ordered** `QA<token>-prod` from AD-03 (two-step confirm).
**Expected:** Deleting an **ordered** product is **blocked/guarded** (immutable order history is protected). The **never-ordered** QA product deletes successfully after the confirm step.

### AD-05 — Users list `[STANDALONE]`
**Steps:** **Users**.
**Expected:** A table of users: **Username · Display name · Role · Email · Active**. Roles render as **Sales / Accounts / Admin**. An **+ Add user** button is present.

### AD-06 — Create a user (with validation) `[CHAIN]` ⭐
**Steps:** **+ Add user**. Test the guards first: password `abc` (<8) → error; passwords that don't match → **"Passwords don't match."**; username `ab` (bad format) → error; an existing username → **"That username is already taken."** Then submit valid: email `qa<token>@example.com`, password `Test1234` (twice), username `qa<token>user`, display name `QA <token> User`, role **Sales** → create. **Capture `NEW_USER` = `qa<token>user`.** Log out → log in as `NEW_USER` with `Test1234`.
**Expected:** Each invalid case shows its message and makes no user. The valid create adds the row; the new user **logs in successfully** and lands on the salesman Home.

### AD-07 — Edit user + reset password `[CHAIN]`
**Steps:** As ADM, **Users** → open `NEW_USER` → change display name to `QA <token> User 2`, keep role Sales → save. Then use **Reset password** → new password `Test5678` (twice) → save. Log out → log in as `NEW_USER` with **old** `Test1234` (should fail) then **new** `Test5678` (should work).
**Expected:** Profile edit persists; old password **fails** ("Wrong username or password."), new password **works**.

### AD-08 — Deactivate / reactivate a user `[CHAIN]`
**Steps:** As ADM, toggle `NEW_USER` **Active → Inactive**. Log out → try to log in as `NEW_USER` → then as ADM reactivate (**Inactive → Active**) → confirm login works again.
**Expected:** Deactivated user **cannot log in** (generic wrong-credentials / deactivated message); reactivation restores login.

### AD-09 — Self-lockout + last-admin guards `[STANDALONE]` ⭐ security
**Steps:** As ADM: (a) open **your own** user row and try to set **Active → Inactive**; (b) in your own Edit modal try to change your **role** away from Admin; (c) if you are the only active admin, also confirm the last-admin message.
**Expected:** (a) blocked — **"You can't deactivate your own account."**; (b) the role select is **disabled** for yourself (with a hint) and the server rejects self-demotion; (c) a demote/deactivate that would leave **zero active admins** is blocked — **"There must be at least one active admin."**

### AD-10 — Non-admin cannot invoke user actions `[STANDALONE]` ⭐ security
**Note:** already covered by AC-13 (accountant redirect) and SM-09 (salesman redirect). Re-confirm here that the **Users** screen and its actions are reachable **only** as admin. (Deep API-level fail-closed checks are out of scope for a browser agent.)

---

## Phase X — Cross-role verification  (re-login as **S1**, then S2)

### X-01 — Salesman sees his order **Processed** `[CHAIN]`
Log in as **S1** → open `REF_ZEB1` → **Expected:** chip **Processed**, with the note "Booked into Tally by the office. For any change, call the accountant." No Edit/Cancel buttons.

### X-02 — Salesman sees LG order **Approved → Processed** `[CHAIN]`
As S1 open `REF_LG` → **Expected:** it is now **Processed** (it passed pending approval → approved → processed). Earlier in-flight it showed **Approved** ("Approved by the office — waiting to be processed").

### X-03 — Office-cancelled order **stays visible** `[CHAIN]`
As S1 open `REF_CANCEL_OFFICE` → **Expected:** visible as **Cancelled — by the office** (contrast SM-08's self-cancel, which vanished from Home).

---

## Result schema (for later aggregation into JSON)

Report each test as one record:

```json
{
  "id": "SM-02",
  "role": "salesman",
  "type": "chain",
  "status": "pass",              // pass | fail | blocked | skipped
  "expected": "Confirmation shows ORDER SUBMITTED + ref + total",
  "observed": "Saw ORD-… , total ₹2,700 matched",
  "captured": { "REF_ZEB1": "ORD-…" },
  "screenshot": "sm-02.png",
  "notes": ""
}
```

At the end, emit the full `carry-forward` map and a summary `{ passed, failed, blocked, skipped }`. Flag every **⭐ security** test failure as **high severity** — those are the permission boundaries that must never break.
```
