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

---

## Every time you want to update stock

1. **RDP into the VPS** and open **Tally**, then **load the company**.
2. **Double-click `run-stock-export.bat`** (in this folder).
   - A black window opens, talks to Tally, and saves a file. Read the message.
   - It prints the saved file's path, e.g.
     `C:\Users\<you>\Desktop\GanpatiStock\stock_2026-07-16_1530.csv`
3. **Open the app** on your phone or laptop → **Products → Update stock** →
   **upload that CSV** → check the preview → **Apply**.
4. Done. Each run makes a **new** file (older ones are kept as history) — always
   upload the newest one.

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

---

## Files in this folder

| File | What it is |
|------|------------|
| `run-stock-export.bat` | Double-click this to run the export. |
| `stock_export.py` | The actual script (Python). Edit the two config lines at the top only if needed. |
| `sample-stock.csv` | An example of what the output looks like (`Tally Name,Stock`). |
| `README.md` | This file. |

The output CSV is always two columns — **`Tally Name,Stock`** — matched to
products in the app by their **Tally name**. Names that don't match any product
are reported after upload so the catalog can be fixed; they are never created.
