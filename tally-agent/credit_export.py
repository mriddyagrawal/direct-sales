# -*- coding: utf-8 -*-
# =============================================================================
#  Ganpati — Tally retailer credit export  (READ-ONLY)
# =============================================================================
#  This script ONLY READS from Tally. It sends Tally "Export" requests
#  (TALLYREQUEST=Export), which are structurally incapable of changing anything
#  in Tally — the export gateway can only read data OUT. This script contains
#  NO write verbs whatsoever: no Import, no Alter, no Create, no <IMPORTDATA>,
#  no <TALLYMESSAGE> voucher/master payload — not even as a commented example.
#  Standard Tally has no per-request read-only login, so the safety comes from
#  the request *type*, which is why this file must never build a write envelope.
#
#  What it does, in one run:
#    0. A quick probe (names only) — proves Tally is answering, counts the shops
#    1. Every party ledger's OPENING + CLOSING balance
#    2. Every voucher touching those parties in the chosen window (the statement)
#  and writes them as two timestamped CSVs on your Desktop, plus the raw XML
#  Tally replied with (so anything odd can be diagnosed exactly).
#
#  FIRST RUN = CALIBRATION. Nothing is uploaded anywhere. Open the balances CSV
#  next to Tally on screen and check 3 shops. The console prints what to compare.
#
#  Requirements: Python 3, standard library only (no `pip install` needed).
#  Run it by double-clicking run-credit-export.bat. See README.md.
# =============================================================================

import csv
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, date

# -----------------------------------------------------------------------------
#  CONFIG — edit these if needed, then save.
# -----------------------------------------------------------------------------
# Where TallyPrime's XML server is listening. Default is this same PC, port 9000.
TALLY_URL = "http://localhost:9000"

# Where the CSVs are saved. Default: a "GanpatiCredit" folder on the Desktop.
OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "GanpatiCredit")

# Statement window, in months back from today. 2 = the last two months.
WINDOW_MONTHS = 2

# Which Tally group holds the shops. Matched loosely (case-insensitive,
# "contains"), so "Sundry Debtors" also catches sub-groups like
# "Sundry Debtors - Bilaspur". If this matches nothing, the script PRINTS every
# group name it saw so you can tell us the right one.
GROUP_FILTER = "Sundry Debtors"

# How long to wait for each step (seconds). Balances and vouchers make Tally do
# real work — a big company can take minutes. The script tells you how long each
# step actually took, so these can be tuned to reality after the first run.
TIMEOUT_PROBE = 60
TIMEOUT_BALANCES = 600
TIMEOUT_VOUCHERS = 900

# Set True to skip the statement pull and only fetch balances (a fast first run).
BALANCES_ONLY = False
# -----------------------------------------------------------------------------


def _window_dates():
    """Return (from_date, to_date) as YYYYMMDD strings — today back WINDOW_MONTHS."""
    today = date.today()
    month = today.month - WINDOW_MONTHS
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1).strftime("%Y%m%d"), today.strftime("%Y%m%d")


FROM_DATE, TO_DATE = _window_dates()

_ENV = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>{cid}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>{coll}</TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>"""

# ---- STEP 0: probe. Names + groups only, NO balances -> Tally answers fast.
# This is what turns "is it stuck?" into "Tally replied in 2s, 214 shops found".
PROBE_XML = _ENV.format(cid="LedgerNames", frm=FROM_DATE, to=TO_DATE, coll="""
      <COLLECTION NAME="LedgerNames" ISMODIFY="No"><TYPE>Ledger</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>""")

# ---- STEP 1a: balances for JUST the debtor group (fast path).
# CHILDOF + BELONGSTO asks Tally to walk only that group and its sub-groups,
# instead of computing a closing balance for every ledger in the company.
BALANCES_FAST_XML = _ENV.format(cid="PartyBalances", frm=FROM_DATE, to=TO_DATE, coll="""
      <COLLECTION NAME="PartyBalances" ISMODIFY="No"><TYPE>Ledger</TYPE>
        <CHILDOF>$$GroupSundryDebtors</CHILDOF><BELONGSTO>Yes</BELONGSTO>
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD><NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
      </COLLECTION>""")

# ---- STEP 1b: fallback — every ledger with balances (slower, always works).
BALANCES_ALL_XML = _ENV.format(cid="PartyBalances", frm=FROM_DATE, to=TO_DATE, coll="""
      <COLLECTION NAME="PartyBalances" ISMODIFY="No"><TYPE>Ledger</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD><NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
      </COLLECTION>""")

# ---- STEP 2: the vouchers in the window.
VOUCHERS_XML = _ENV.format(cid="PartyVouchers", frm=FROM_DATE, to=TO_DATE, coll="""
      <COLLECTION NAME="PartyVouchers" ISMODIFY="No"><TYPE>Voucher</TYPE>
        <NATIVEMETHOD>Date</NATIVEMETHOD><NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
        <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD><NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
        <NATIVEMETHOD>Narration</NATIVEMETHOD><NATIVEMETHOD>AllLedgerEntries</NATIVEMETHOD>
      </COLLECTION>""")


class _Ticker(object):
    """Prints a live 'still working' line while a blocking request is in flight.
    Tally gives no progress of its own, so without this a slow-but-healthy pull
    is indistinguishable from a hang — which is exactly what it looked like."""

    def __init__(self, label):
        self.label = label
        self._stop = threading.Event()
        self._bytes = 0
        self._t0 = time.time()
        self._thread = threading.Thread(target=self._run)
        self._thread.daemon = True

    def _run(self):
        while not self._stop.wait(2.0):
            secs = int(time.time() - self._t0)
            got = "  {:,} KB so far".format(self._bytes // 1024) if self._bytes else "  waiting for Tally to answer"
            sys.stdout.write("\r   {} ... {}s{}   ".format(self.label, secs, got))
            sys.stdout.flush()

    def start(self):
        self._thread.start()
        return self

    def add(self, n):
        self._bytes += n

    def done(self):
        self._stop.set()
        self._thread.join(timeout=1)
        secs = time.time() - self._t0
        sys.stdout.write("\r   {} ... done in {:.1f}s ({:,} KB)          \n".format(
            self.label, secs, self._bytes // 1024))
        sys.stdout.flush()
        return secs


def _post_to_tally(request_xml, label, timeout):
    """Send ONE Export request and return the response bytes, showing progress.
    Reads in chunks so the byte counter moves while Tally streams its answer."""
    ticker = _Ticker(label).start()
    try:
        req = urllib.request.Request(
            TALLY_URL,
            data=request_xml.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8"},
            method="POST",
        )
        chunks = []
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                ticker.add(len(chunk))
        return b"".join(chunks)
    finally:
        ticker.done()


def _sanitize_xml(raw_bytes):
    """Tally often emits bytes that aren't valid XML (Windows-1252 chars and
    stray control characters). Decode leniently and strip the illegal controls."""
    text = raw_bytes.decode("utf-8", errors="replace")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def _text(el, tag):
    """Child tag's text, or '' — Tally omits tags rather than emptying them."""
    child = el.find(tag)
    return (child.text or "").strip() if child is not None and child.text else ""


def _name_of(el):
    """Tally puts NAME on the element as an attribute OR as a child, by version."""
    return (el.get("NAME") or "").strip() or _text(el, "NAME")


def _amount(raw):
    """Tally amount string -> float. Handles '1,234.50', '-1234.5', '1234 Dr'.
    Returns None when there's no number at all. The SIGN IS LEFT EXACTLY AS
    TALLY SENT IT — deciding what a positive number means is the whole point of
    the calibration run, so this function must never 'helpfully' flip it."""
    if not raw:
        return None
    cleaned = raw.replace(",", "").strip()
    m = re.search(r"-?\d+(\.\d+)?", cleaned)
    if not m:
        return None
    value = float(m.group(0))
    if re.search(r"\bCr\b", cleaned, re.I):
        value = -abs(value)
    elif re.search(r"\bDr\b", cleaned, re.I):
        value = abs(value)
    return value


def _parse_ledgers(raw_bytes, want_balances):
    """-> (rows, groups_seen). Filters to GROUP_FILTER; groups_seen is every
    parent group encountered, so a wrong filter can be diagnosed instantly."""
    root = ET.fromstring(_sanitize_xml(raw_bytes))
    rows, groups = [], {}
    for led in root.iter("LEDGER"):
        name = _name_of(led)
        if not name:
            continue
        parent = _text(led, "PARENT")
        groups[parent] = groups.get(parent, 0) + 1
        if GROUP_FILTER.lower() not in parent.lower():
            continue
        row = {"name": name, "group": parent}
        if want_balances:
            row.update({
                "raw_opening": _text(led, "OPENINGBALANCE"),
                "raw_closing": _text(led, "CLOSINGBALANCE"),
                "opening": _amount(_text(led, "OPENINGBALANCE")),
                "closing": _amount(_text(led, "CLOSINGBALANCE")),
            })
        rows.append(row)
    return rows, groups


def _parse_vouchers(raw_bytes, party_names):
    """-> (entries, skipped). One entry per (voucher x party-ledger) movement."""
    root = ET.fromstring(_sanitize_xml(raw_bytes))
    wanted = {n.lower() for n in party_names}
    entries, skipped = [], 0
    for v in root.iter("VOUCHER"):
        vdate = _text(v, "DATE")
        if len(vdate) == 8 and vdate.isdigit():
            vdate = "{}-{}-{}".format(vdate[0:4], vdate[4:6], vdate[6:8])
        vtype, vno = _text(v, "VOUCHERTYPENAME"), _text(v, "VOUCHERNUMBER")
        narr = _text(v, "NARRATION")
        matched_any = False
        for tag in ("ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST"):
            for le in v.iter(tag):
                lname = _text(le, "LEDGERNAME")
                if lname.lower() not in wanted:
                    continue
                amt = _amount(_text(le, "AMOUNT"))
                if amt is None:
                    continue
                matched_any = True
                entries.append({
                    "ledger": lname, "date": vdate, "type": vtype, "voucher_no": vno,
                    "narration": narr, "raw_amount": _text(le, "AMOUNT"), "amount": amt,
                })
        if not matched_any and _text(v, "PARTYLEDGERNAME").lower() in wanted:
            skipped += 1
    return entries, skipped


def _write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def _dump(stamp, name, raw):
    path = os.path.join(OUTPUT_DIR, "raw_{}_{}.xml".format(name, stamp))
    with open(path, "wb") as fh:
        fh.write(raw)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    print("Ganpati - Tally credit export (READ-ONLY)")
    print("Window: {} to {}".format(FROM_DATE, TO_DATE))
    print("Saving to: {}\n".format(OUTPUT_DIR))
    print("Step 1 of 3 - checking Tally is answering (names only, quick)")

    # ---- 0. probe: names + groups only. No balance maths, so this is fast. ----
    raw_probe = _post_to_tally(PROBE_XML, "probe", TIMEOUT_PROBE)
    _dump(stamp, "probe", raw_probe)
    probe_rows, groups = _parse_ledgers(raw_probe, want_balances=False)
    total_ledgers = sum(groups.values())
    print("   Tally answered: {:,} ledgers in the company, {:,} under {!r}\n".format(
        total_ledgers, len(probe_rows), GROUP_FILTER))

    if not probe_rows:
        print("  No ledgers matched the group filter {!r}.".format(GROUP_FILTER))
        print("  Groups Tally actually returned (name : ledger count):")
        for g, n in sorted(groups.items(), key=lambda kv: -kv[1])[:25]:
            print("    {:<40} {}".format(g or "(blank)", n))
        print("\n  Edit GROUP_FILTER near the top of this file, or send this list over.")
        return

    # ---- 1. balances: try the group-scoped request first, fall back to all ----
    print("Step 2 of 3 - fetching balances for {:,} shops".format(len(probe_rows)))
    print("   (Tally computes each balance from its vouchers, so this is the slow part)")
    raw_bal = _post_to_tally(BALANCES_FAST_XML, "balances", TIMEOUT_BALANCES)
    parties, _ = _parse_ledgers(raw_bal, want_balances=True)
    if not parties:
        print("   Group-scoped request returned nothing on this Tally - retrying the")
        print("   whole-company way (slower, but works everywhere)")
        raw_bal = _post_to_tally(BALANCES_ALL_XML, "balances (fallback)", TIMEOUT_BALANCES)
        parties, _ = _parse_ledgers(raw_bal, want_balances=True)
    _dump(stamp, "balances", raw_bal)
    print("   Got balances for {:,} shops\n".format(len(parties)))

    # ---- 2. vouchers ---------------------------------------------------------
    entries, skipped = [], 0
    if BALANCES_ONLY:
        print("Step 3 of 3 - SKIPPED (BALANCES_ONLY is True)\n")
    else:
        print("Step 3 of 3 - fetching the statement ({} to {})".format(FROM_DATE, TO_DATE))
        raw_vch = _post_to_tally(VOUCHERS_XML, "statement", TIMEOUT_VOUCHERS)
        _dump(stamp, "vouchers", raw_vch)
        entries, skipped = _parse_vouchers(raw_vch, [p["name"] for p in parties])
        print("   Got {:,} statement lines\n".format(len(entries)))

    # ---- 3. write the CSVs ---------------------------------------------------
    bal_path = os.path.join(OUTPUT_DIR, "credit_balances_{}.csv".format(stamp))
    _write_csv(
        bal_path,
        ["Ledger Name", "Group", "Closing (as Tally sent it)", "Closing (number)",
         "Opening (as Tally sent it)", "Opening (number)"],
        [[p["name"], p["group"], p.get("raw_closing", ""),
          "" if p.get("closing") is None else p["closing"],
          p.get("raw_opening", ""), "" if p.get("opening") is None else p["opening"]]
         for p in parties],
    )
    ent_path = os.path.join(OUTPUT_DIR, "credit_entries_{}.csv".format(stamp))
    _write_csv(
        ent_path,
        ["Ledger Name", "Date", "Voucher Type", "Voucher No",
         "Amount (as Tally sent it)", "Amount (number)", "Narration"],
        [[e["ledger"], e["date"], e["type"], e["voucher_no"],
          e["raw_amount"], e["amount"], e["narration"]] for e in entries],
    )

    # ---- 4. the calibration report ------------------------------------------
    nonzero = [p for p in parties if p.get("closing")]
    total = sum(p.get("closing") or 0 for p in parties)
    print("=" * 66)
    print("  DONE - nothing was uploaded anywhere. Files written:")
    print("    {}".format(os.path.basename(bal_path)))
    print("    {}   ({:,} lines)".format(os.path.basename(ent_path), len(entries)))
    print("    raw_probe / raw_balances / raw_vouchers .xml  (for diagnosing)")
    print("=" * 66)
    print("  Shops with a balance ..... {:,} of {:,}".format(len(nonzero), len(parties)))
    print("  Statement lines .......... {:,}".format(len(entries)))
    if skipped:
        print("  Vouchers not readable .... {:,}".format(skipped))
    print("  Sum of closing balances .. {:,.2f}   (negated: {:,.2f})".format(total, -total))
    print("-" * 66)
    print("  CHECK THESE 3 IN TALLY - do the amounts and the direction match?")
    for p in sorted(nonzero, key=lambda r: -abs(r["closing"]))[:3]:
        print("    {:<34} {:>16}".format(p["name"][:34], p.get("raw_closing", "")))
    print("\n  If a shop that OWES you money shows a minus sign above, tell us -")
    print("  the app flips the sign once, centrally, and everything follows.")
    print("=" * 66)


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, socket.timeout, ConnectionError) as exc:
        print("\n\n  Tally did not answer in time, or could not be reached.")
        print("  - Is TallyPrime open with the company loaded?")
        print("  - Is the XML server on?  (Help > Settings > Connectivity, port 9000)")
        print("  - Big company? Raise TIMEOUT_BALANCES / TIMEOUT_VOUCHERS at the top,")
        print("    or set BALANCES_ONLY = True for a quicker first run.")
        print("  Technical detail: {}".format(exc))
    except ET.ParseError as exc:
        print("\n\n  Tally answered, but the reply could not be read as XML.")
        print("  The raw reply was still saved in {} - send it over.".format(OUTPUT_DIR))
        print("  Technical detail: {}".format(exc))
    except Exception as exc:  # noqa: BLE001 - operator-facing, never a traceback
        print("\n\n  Something went wrong: {}".format(exc))
        print("  Nothing was changed in Tally (this script only ever reads).")
    input("\n  Press Enter to close ...")
