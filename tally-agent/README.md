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
| `run-stock-export.bat` | Double-click this to run the export. |
| `stock_export.py` | The actual script (Python). Edit the two config lines at the top only if needed. |
| `sample-stock.csv` | An example of what the output looks like (`Tally Name,Stock`). |
| `agent_config.example.ini` | Template for one-click auto-submit — copy to `agent_config.ini` and add the secret. |
| `agent_config.ini` | *Your* auto-submit config (you create it; holds the secret). Not committed to git. |
| `README.md` | This file. |

The output CSV is always two columns — **`Tally Name,Stock`** — matched to
products in the app by their **Tally name**. Names that don't match any product
are reported after upload so the catalog can be fixed; they are never created.
