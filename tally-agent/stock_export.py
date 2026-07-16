# -*- coding: utf-8 -*-
# =============================================================================
#  Ganpati — Tally stock export  (READ-ONLY)
# =============================================================================
#  This script ONLY READS from Tally. It sends a single Tally "Export" request
#  (TALLYREQUEST=Export), which is structurally incapable of changing anything
#  in Tally — the export gateway can only read data OUT. This script contains
#  NO write verbs whatsoever: no Import, no Alter, no Create, no <IMPORTDATA>,
#  no <TALLYMESSAGE> voucher/master payload — not even as a commented example.
#  Standard Tally has no per-request read-only login, so the safety comes from
#  the request *type*, which is why this file must never build a write envelope.
#
#  What it does: asks Tally for every stock item's Name + ClosingBalance, and
#  writes a fresh timestamped CSV (Tally Name,Stock) to your Desktop. You then
#  upload that CSV in the web app under Products -> Update stock.
#
#  Requirements: Python 3, standard library only (no `pip install` needed).
#  Run it by double-clicking run-stock-export.bat. See README.md.
# =============================================================================

import configparser
import csv
import json
import os
import re
import socket
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

# -----------------------------------------------------------------------------
#  CONFIG — edit these two if needed, then save.
# -----------------------------------------------------------------------------
# Where TallyPrime's XML server is listening. Default is this same PC, port 9000.
TALLY_URL = "http://localhost:9000"

# Where the CSV files are saved. Default: a "GanpatiStock" folder on the Desktop.
OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "GanpatiStock")

# How long to wait for Tally to answer (seconds) before giving up.
TIMEOUT_SECONDS = 15

# Optional auto-submit: if agent_config.ini sits next to this script, the export
# ALSO pushes the stock straight into the app (one click). Without it, the script
# just writes the CSV for a manual upload. See README + agent_config.example.ini.
# (This pushes to OUR app, never to Tally — the Tally side stays strictly read-only.)
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.ini")
# -----------------------------------------------------------------------------

# A Collection "Export" of every StockItem, fetching just Name + ClosingBalance.
# ISMODIFY="No" is belt-and-braces: this collection never modifies anything.
# (TALLYREQUEST=Export = read-only; see the header note above.)
REQUEST_XML = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>StockSummary</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="StockSummary" ISMODIFY="No"><TYPE>StockItem</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>ClosingBalance</NATIVEMETHOD></COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>"""

# ---- FALLBACK (READ-ONLY too) ------------------------------------------------
# If the Collection export above returns 0 items on your Tally version, the
# alternative is a Stock Summary REPORT export (also TALLYREQUEST=Export, still
# read-only). To try it, set USE_FALLBACK = True below. It asks Tally to render
# the "Stock Summary" report as XML; the same parser reads STOCKITEM/NAME/
# CLOSINGBALANCE out of it. This is ALSO strictly a read — no write verbs.
USE_FALLBACK = False
FALLBACK_XML = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Stock Summary</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY>
</ENVELOPE>"""
# -----------------------------------------------------------------------------


def _sanitize_xml(raw_bytes):
    """Tally often emits bytes that aren't valid XML (Windows-1252 chars and
    stray control characters like \\x04). Decode leniently and strip the illegal
    control chars so ElementTree can parse it."""
    text = raw_bytes.decode("utf-8", errors="replace")
    # Keep tab (\x09), newline (\x0a), carriage return (\x0d); drop other C0 controls.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def _post_to_tally(request_xml):
    """Send one Export request to Tally and return the raw response bytes.
    Raises urllib/socket errors on connection problems (handled by the caller)."""
    data = request_xml.encode("utf-8")
    req = urllib.request.Request(
        TALLY_URL,
        data=data,
        headers={"Content-Type": "text/xml; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return resp.read()


def _parse_qty(balance_text):
    """Pull an integer quantity out of a Tally ClosingBalance string.
    Examples: ' 12.00 Nos' -> 12,  '-3 Nos' -> -3,  '1,234 Nos' -> 1234.
    Returns None when there is no parseable number (so the caller can skip it)."""
    if balance_text is None:
        return None
    cleaned = balance_text.replace(",", "")
    m = re.search(r"-?\d+(\.\d+)?", cleaned)
    if not m:
        return None
    return int(round(float(m.group(0))))


def _extract_items(raw_bytes):
    """Parse the Tally XML into a list of (name, qty) pairs.
    Handles NAME as either an attribute of <STOCKITEM> or a child <NAME>."""
    text = _sanitize_xml(raw_bytes)
    root = ET.fromstring(text)

    items = []
    skipped = 0
    for si in root.iter("STOCKITEM"):
        # NAME can arrive as an attribute or as a child element, depending on
        # the Tally version — handle both.
        name = (si.get("NAME") or "").strip()
        if not name:
            child = si.find("NAME")
            if child is not None and child.text:
                name = child.text.strip()

        bal_el = si.find("CLOSINGBALANCE")
        bal_text = bal_el.text if bal_el is not None else None

        qty = _parse_qty(bal_text)
        if not name or qty is None:
            skipped += 1
            continue
        items.append((name, qty))
    return items, skipped


def _write_csv(items):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    path = os.path.join(OUTPUT_DIR, "stock_{}.csv".format(stamp))
    # Never overwrite: every run makes a new timestamped file (keeps history).
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Tally Name", "Stock"])
        for name, qty in items:
            writer.writerow([name, qty])
    return path


def _load_push_config():
    """Return {url, anon, secret} if agent_config.ini is present and complete,
    else None (auto-push simply off — the CSV is still written for a manual
    upload). Never raises: a broken config just falls back to CSV-only."""
    if not os.path.exists(CONFIG_PATH):
        return None
    try:
        cp = configparser.ConfigParser()
        cp.read(CONFIG_PATH, encoding="utf-8")
        sec = cp["app"]
        url = sec.get("supabase_url", "").strip().rstrip("/")
        anon = sec.get("anon_key", "").strip()
        secret = sec.get("push_secret", "").strip()
    except Exception:
        return None
    if not (url and anon and secret):
        return None
    return {"url": url, "anon": anon, "secret": secret}


def _push_to_app(items, cfg):
    """POST the stock rows to the app's secret-guarded import endpoint
    (import_stock_agent). Returns (matched, unmatched_list). Raises on a
    transport/HTTP error so the caller can fall back to the manual upload."""
    rows = [{"tally_name": name, "stock_qty": qty} for name, qty in items]
    body = json.dumps({"p_secret": cfg["secret"], "p_rows": rows}).encode("utf-8")
    endpoint = cfg["url"] + "/rest/v1/rpc/import_stock_agent"
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/json",
            "apikey": cfg["anon"],
            "Authorization": "Bearer " + cfg["anon"],
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("matched", 0), (data.get("unmatched") or [])


def main():
    print("Ganpati stock export - reading from Tally at {} ...".format(TALLY_URL))
    print("(read-only: this only asks Tally to export data; it never changes anything)")
    print("")

    request_xml = FALLBACK_XML if USE_FALLBACK else REQUEST_XML
    try:
        raw = _post_to_tally(request_xml)
    except (urllib.error.URLError, socket.timeout, ConnectionError, OSError):
        print(
            "Could not reach Tally at {} - is TallyPrime open with the company "
            "loaded and the XML server (port 9000) enabled? See README.".format(TALLY_URL)
        )
        return 1

    items, skipped = _extract_items(raw)

    if not items:
        print(
            "Connected, but Tally returned 0 stock items - check the company is "
            "loaded. (If your Tally version needs it, open stock_export.py and set "
            "USE_FALLBACK = True, then run again. See README.)"
        )
        return 1

    path = _write_csv(items)
    print("Saved {} stock items to:".format(len(items)))
    print("   {}".format(path))
    if skipped:
        print("Skipped {} item(s) with a blank name or an unreadable balance.".format(skipped))

    cfg = _load_push_config()
    if cfg is None:
        print("")
        print("Done! Now open the app -> Products -> Update stock -> upload that file.")
        print("(Tip: set up agent_config.ini to auto-submit next time. See README.)")
        return 0

    print("")
    print("Submitting stock to the app ...")
    try:
        matched, unmatched = _push_to_app(items, cfg)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")
        except Exception:
            pass
        print("   Could not submit to the app (HTTP {}). {}".format(exc.code, detail))
        print("   The CSV is saved - upload it manually via Products -> Update stock.")
        return 1
    except (urllib.error.URLError, socket.timeout, ConnectionError, OSError, ValueError) as exc:
        print("   Could not submit to the app: {}".format(exc))
        print("   The CSV is saved - upload it manually via Products -> Update stock.")
        return 1

    print("   Updated {} product(s) in the app.".format(matched))
    if unmatched:
        print("   {} Tally name(s) didn't match a product (fix the name in the catalog):".format(len(unmatched)))
        print("     " + ", ".join(unmatched))
    print("")
    print("Done! Stock is live in the app.")
    return 0


if __name__ == "__main__":
    # Wrap everything so the operator sees a clean message, never a raw traceback.
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - deliberately friendly catch-all
        print("Something went wrong while exporting stock: {}".format(exc))
        print("If this keeps happening, send this message to the developer.")
        raise SystemExit(1)
