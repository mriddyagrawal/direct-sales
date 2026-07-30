# Ganpati — Tally stock export

A tiny, **read-only** tool that pulls current stock quantities out of Tally and
saves them as a CSV file. You then upload that file in the web app
(**Products → Update stock**) so salesmen can see what's in the godown.

> **It never changes anything in Tally.** The script only ever sends an *Export*
> request, which can only read data out — it cannot create, edit, or delete
> vouchers, items, or masters. There is no write code anywhere in it.

Runs on the **Windows VPS where Tally lives**. Needs Python 3 (free). No internet
libraries to install.

---

## One-time setup (do this once)

1. **Install Python 3**
   - Go to <https://www.python.org/downloads/> → **Download Python 3.x** → run the installer.
   - On the first screen, **tick the box "Add python.exe to PATH"** (bottom of the window), then click **Install Now**.

2. **Turn on Tally's XML server** (so this tool can ask Tally for the numbers)
   - **TallyPrime:** `Help (F1) → Settings → Connectivity → Client/Server configuration` →
     set **TallyPrime acts as: Server**, **Port: 9000** → accept.
   - **Tally.ERP 9:** from the Gateway of Tally, `F12: Configure → Advanced Configuration` →
     set **TallyPrime/Tally acts as: Server**, **Port: 9000**.
   - Keep **the company open** in Tally whenever you run the export.

3. **(Optional) Turn on one-click auto-submit** — so the export *also* sends the
   stock into the app automatically, with no file to upload.
   - In this folder, make a copy of **`agent_config.example.ini`** and name the
     copy **`agent_config.ini`**.
   - Open `agent_config.ini` in Notepad and paste the **stock-push secret** (ask
     the developer) into the `push_secret =` line, then save.
   - That's it — `supabase_url` and `anon_key` are already filled in. The secret
     can *only* update stock counts, nothing else, but treat it like a password.

---

## Every time you want to update stock

1. **RDP into the VPS** and open **Tally**, then **load the company**.
2. **Double-click `run-stock-export.bat`** (in this folder). A black window opens,
   talks to Tally, saves a CSV, and prints the result.
3. **Then:**
   - **If you set up auto-submit** (one-time step 3): it submits by itself and
     prints `Updated N product(s) in the app.` — **you're done, nothing to upload.**
     It also lists any Tally names that didn't match a product (fix those in the
     catalog).
   - **If you didn't:** open the app → **Products → Update stock** → **upload the
     CSV** it just saved (the path is printed, e.g.
     `C:\Users\<you>\Desktop\GanpatiStock\stock_2026-07-16_1530.csv`) → check the
     preview → **Apply**.
4. Either way, each run also keeps a **new** CSV as history.

---

## If something goes wrong

- **"Could not reach Tally at http://localhost:9000…"**
  Tally isn't open, the company isn't loaded, or the XML server (port 9000) is off.
  → Open Tally, load the company, and check the one-time step 2 above. Then run again.

- **"Connected, but Tally returned 0 stock items…"**
  Tally answered but sent no items. Make sure the correct company is loaded.
  If your Tally version just doesn't return items from this request, open
  `stock_export.py` in Notepad, change the line `USE_FALLBACK = False` to
  `USE_FALLBACK = True`, save, and run again. That uses the **Stock Summary
  report** export instead (still read-only).

- **"python is not recognized…" / the window flashes and closes**
  Python isn't installed or wasn't added to PATH. Re-run the Python installer and
  make sure **"Add python.exe to PATH"** is ticked (one-time step 1).

- **Wrong numbers?** The tool reads each item's **Closing Balance** as-is. Fix the
  stock in Tally, then export again.

- **Auto-submit says "Could not submit to the app"**
  The internet may be down, or the `push_secret` in `agent_config.ini` is wrong.
  The CSV is still saved, so you can upload it manually via **Products → Update
  stock**. If it keeps failing, re-check the secret with the developer.

---

## Files in this folder

| File | What it is |
|------|------------|
| `run-stock-export.bat` | Double-click this to run the **stock** export. |
| `stock_export.py` | The actual script (Python). Edit the two config lines at the top only if needed. |
| `run-credit-export.bat` | Double-click this to run the **retailer credit** export (see below). |
| `credit_export.py` | The credit script. Config block at the top: window length, group name. |
| `ledger_statement_export.py` | **Double-click this one directly** for the **ledger statement** export (see below). No `.bat` needed. |
| `sample-stock.csv` | An example of what the output looks like (`Tally Name,Stock`). |
| `agent_config.example.ini` | Template for one-click auto-submit — copy to `agent_config.ini` and add the secret. |
| `agent_config.ini` | *Your* auto-submit config (you create it; holds the secret). Not committed to git. |
| `README.md` | This file. |

The output CSV is always two columns — **`Tally Name,Stock`** — matched to
products in the app by their **Tally name**. Names that don't match any product
are reported after upload so the catalog can be fixed; they are never created.


---

# Ganpati — Tally retailer credit export

Pulls what each shop **owes**, and the bills/receipts behind it, out of Tally.
Same rules as the stock export: **read-only**, Python 3, standard library only,
double-click a `.bat`. Nothing is uploaded anywhere — it writes files you look at.

## Every time

1. RDP into the VPS. Open TallyPrime and load the company (as usual).
2. Double-click **`run-credit-export.bat`**.
3. It runs in three steps and shows a live counter for each — seconds elapsed and
   KB received — so you can always tell it's working rather than stuck:

   | Step | What it does | Typical |
   |------|--------------|---------|
   | 1 of 4 | Reads the group tree | instant |
   | 2 of 4 | Probe — ledger names only, no maths | seconds |
   | 3 of 4 | Balances for the shops | the slow one: Tally recomputes each balance from its vouchers |
   | 4 of 4 | The statement (vouchers in the window) | depends on how busy those months were |

   **Every run prints where the shops actually sit**, e.g.
   `IN   24  appl pali friday < sundry debtors < primary`. Rows marked `IN` are
   included. This matters: in this company the shops live in **beat groups**
   (`Appl Pali FRIDAY`, `SARGAM WHOLESALE WEDNUSDAY`, …) *underneath* the top
   group — matching on a ledger's immediate parent name finds the wrong ledgers
   entirely. If nothing is marked `IN`, set **`ROOT_GROUP`** at the top of the
   script to the right top group from those paths (or `""` to take every ledger).

   Set **`BALANCES_ONLY = True`** to skip step 4 for a quicker first run.
4. It prints a summary and writes files to **`Desktop\GanpatiCredit`**:

| File | What it is |
|------|------------|
| `credit_balances_<date>_<time>.csv` | One row per shop: closing + opening balance |
| `credit_entries_<date>_<time>.csv` | The statement — one row per bill/receipt/note |
| `raw_balances_<date>_<time>.xml` | Exactly what Tally replied (for diagnosing) |
| `raw_vouchers_<date>_<time>.xml` | Same, for the vouchers |
| `raw_probe_<date>_<time>.xml` | Same, for the quick first check |

## The first run is a calibration — please check it

The balances CSV keeps **two columns per amount**: the text exactly as Tally sent
it, and the number read out of it. That is deliberate — it makes the one genuinely
uncertain thing checkable at a glance:

- **Does a shop that OWES money show a minus sign?** Tally often exports a
  receivable as a negative number. The console prints the three biggest balances
  for exactly this comparison — open Tally's own outstanding report next to it.
- **Did the right ledgers come through?** If the group filter matches nothing,
  the script prints every group name it saw. Send that list over and we set it.
- **How many shops matched?** Compare the party count against what you expect.

Once those three answers are known, the sign is fixed **once, centrally**, and
the app side gets built on top.

## Config (top of `credit_export.py`)

| Setting | Default | Meaning |
|---------|---------|---------|
| `WINDOW_MONTHS` | `2` | How far back the statement goes |
| `GROUP_FILTER` | `Sundry Debtors` | Which Tally group holds the shops (loose match, catches sub-groups) |
| `TIMEOUT_BALANCES` | `600` | Step 2 budget — raise it for a large company |
| `TIMEOUT_VOUCHERS` | `900` | Step 3 budget |
| `BALANCES_ONLY` | `False` | `True` = skip the statement, balances only (fast first run) |

## If something goes wrong

- **It looks frozen** — check the live counter. If seconds are climbing, Tally is
  working; balances on a big company genuinely take minutes. If it times out, raise
  the timeouts or set `BALANCES_ONLY = True`.
- **"Tally did not answer in time"** — Tally isn't open, the company isn't loaded,
  the XML server (port 9000) is off, or the company is big enough to need a longer
  timeout. Same first checks as the stock export.
- **"No ledgers matched"** — the group name differs; the printed list has the answer.
- **Anything else** — the raw XML files are still written. Send them over and the
  parser gets fixed against your actual data rather than a guess.

---

# Ganpati — Tally ledger statement export

One row per **ledger entry** for every voucher in a date range — the columns of
Tally's own Ledger Vouchers screen (date, ledger, voucher type, voucher number,
debit, credit), for **every ledger at once**. Same rules as the others:
**read-only**, Python 3, standard library only.

## Every time

1. RDP into the VPS. Open TallyPrime and load the company.
2. **Double-click `ledger_statement_export.py`.** No `.bat`, no terminal — it
   shows a menu and the window stays open at the end so you can read the result.

   ```
   1   Check the connection      (do this first, takes seconds)
   2   Export the last 2 months
   3   Export a date range you choose
   4   Quit
   ```

3. Files land in **`Desktop\GanpatiLedger`**.

**Run option 1 before the first real export.** It answers two things we don't yet
know about this company: which of Tally's two ledger-entry collections actually
holds the rows, and whether a time-of-entry field exists at all (there is no
standard one — it depends on whether Edit Log is switched on).

## Output

`ledger_entries_<date>_<time>.csv` — one row per ledger entry:

| Column | Notes |
|---|---|
| `date`, `voucher_type`, `voucher_no` | from the voucher |
| `ledger` | the ledger this leg hits — "Particulars" on the Tally screen |
| `amount`, `is_debit` | signed number **plus** an explicit Dr/Cr flag |
| `debit`, `credit` | derived from `is_debit`, never from the sign |
| `party`, `narration`, `guid`, `alter_id` | context and keys |

Every raw reply is kept as `raw_<source>_<yyyymmdd>.xml` — if a number ever looks
wrong, that file is the evidence.

**Why two amount columns?** Tally's internal sign convention for debits catches
everyone out, so the script asks Tally directly (`$$IsDebit`) rather than
guessing from the sign. Trust `debit`/`credit`; treat `amount` as the raw value.

## Config (top of `ledger_statement_export.py`)

| Setting | Default | Meaning |
|---------|---------|---------|
| `DEFAULT_MONTHS_BACK` | `2` | Window when you pick "last 2 months" |
| `CHUNK_MONTHS` | `1` | Months per request to Tally |
| `ENTRY_SOURCES` | both | Narrow to one after running option 1 |
| `EXCLUDE_CANCELLED` / `EXCLUDE_OPTIONAL` | `True` | Filtered inside Tally |

## If something goes wrong

- **A step shows `0 rows`** — the script prints how many bytes Tally actually
  sent and the start of the reply, and saves the whole thing. Run option 1: it
  tries three progressively more complex requests and tells you which one first
  comes back empty. That pinpoints the problem exactly.
- **"Could not reach Tally"** — same first checks as the other two exports.
- **Statement doesn't tie to Tally's screen** — this exports *transactions only*,
  with **no opening balance**. Ask and it can be added.
