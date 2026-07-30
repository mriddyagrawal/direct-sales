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

# How long to wait for Tally to answer (seconds). The voucher pull is heavier
# than the stock one, so this is generous.
TIMEOUT_SECONDS = 120
# -----------------------------------------------------------------------------


def _window_dates():
    """Return (from_date, to_date) as YYYYMMDD strings — today back WINDOW_MONTHS."""
    today = date.today()
    month = today.month - WINDOW_MONTHS
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    start = date(year, month, 1)
    return start.strftime("%Y%m%d"), today.strftime("%Y%m%d")


FROM_DATE, TO_DATE = _window_dates()

# ---- REQUEST 1: every ledger with its balances (READ-ONLY Collection export) --
# Deliberately fetches ALL ledgers, not just debtors: filtering happens in
# Python so that a wrong GROUP_FILTER is visible (the script lists the groups it
# found) instead of silently returning nothing.
BALANCES_XML = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyBalances</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="PartyBalances" ISMODIFY="No"><TYPE>Ledger</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>""".format(frm=FROM_DATE, to=TO_DATE)

# ---- REQUEST 2: the vouchers in the window (READ-ONLY Collection export) ------
VOUCHERS_XML = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyVouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="PartyVouchers" ISMODIFY="No"><TYPE>Voucher</TYPE>
        <NATIVEMETHOD>Date</NATIVEMETHOD>
        <NATIVEMETHOD>VoucherTypeName</NATIVEMETHOD>
        <NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>
        <NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD>
        <NATIVEMETHOD>Narration</NATIVEMETHOD>
        <NATIVEMETHOD>AllLedgerEntries</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>""".format(frm=FROM_DATE, to=TO_DATE)


def _sanitize_xml(raw_bytes):
    """Tally often emits bytes that aren't valid XML (Windows-1252 chars and
    stray control characters). Decode leniently and strip the illegal controls."""
    text = raw_bytes.decode("utf-8", errors="replace")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


def _post_to_tally(request_xml):
    """Send ONE Export request to Tally and return the raw response bytes."""
    req = urllib.request.Request(
        TALLY_URL,
        data=request_xml.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
        return resp.read()


def _text(el, tag):
    """Child tag's text, or '' — Tally omits tags rather than emptying them."""
    child = el.find(tag)
    return (child.text or "").strip() if child is not None and child.text else ""


def _name_of(el):
    """Tally puts NAME on the element as an attribute OR as a child, by version."""
    name = (el.get("NAME") or "").strip()
    if name:
        return name
    return _text(el, "NAME")


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
    # An explicit Cr/Dr suffix, when present, is authoritative over the sign.
    if re.search(r"\bCr\b", cleaned, re.I):
        value = -abs(value)
    elif re.search(r"\bDr\b", cleaned, re.I):
        value = abs(value)
    return value


def _parse_balances(raw_bytes):
    """-> (rows, groups_seen). rows = dicts of one party ledger each."""
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
        rows.append({
            "name": name,
            "group": parent,
            "raw_opening": _text(led, "OPENINGBALANCE"),
            "raw_closing": _text(led, "CLOSINGBALANCE"),
            "opening": _amount(_text(led, "OPENINGBALANCE")),
            "closing": _amount(_text(led, "CLOSINGBALANCE")),
        })
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
        vtype = _text(v, "VOUCHERTYPENAME")
        vno = _text(v, "VOUCHERNUMBER")
        narr = _text(v, "NARRATION")
        matched_any = False
        # A voucher's party movement lives in its ledger entries. Tally names the
        # list tag differently across versions, so accept both spellings.
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
                    "ledger": lname, "date": vdate, "type": vtype,
                    "voucher_no": vno, "narration": narr,
                    "raw_amount": _text(le, "AMOUNT"), "amount": amt,
                })
        if not matched_any and _text(v, "PARTYLEDGERNAME").lower() in wanted:
            skipped += 1
    return entries, skipped


def _write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    print("Ganpati — Tally credit export (READ-ONLY)")
    print("Window: {} to {}\n".format(FROM_DATE, TO_DATE))

    # ---- 1. balances ---------------------------------------------------------
    print("Asking Tally for ledger balances ...")
    raw_bal = _post_to_tally(BALANCES_XML)
    with open(os.path.join(OUTPUT_DIR, "raw_balances_{}.xml".format(stamp)), "wb") as fh:
        fh.write(raw_bal)
    parties, groups = _parse_balances(raw_bal)

    if not parties:
        print("\n  No ledgers matched the group filter {!r}.".format(GROUP_FILTER))
        print("  Groups Tally actually returned (name : ledger count):")
        for g, n in sorted(groups.items(), key=lambda kv: -kv[1])[:25]:
            print("    {:<40} {}".format(g or "(blank)", n))
        print("\n  Edit GROUP_FILTER near the top of this file, or send this list over.")
        return

    # ---- 2. vouchers ---------------------------------------------------------
    print("Found {} party ledgers. Asking for their vouchers ...".format(len(parties)))
    raw_vch = _post_to_tally(VOUCHERS_XML)
    with open(os.path.join(OUTPUT_DIR, "raw_vouchers_{}.xml".format(stamp)), "wb") as fh:
        fh.write(raw_vch)
    entries, skipped = _parse_vouchers(raw_vch, [p["name"] for p in parties])

    # ---- 3. write the CSVs ---------------------------------------------------
    bal_path = os.path.join(OUTPUT_DIR, "credit_balances_{}.csv".format(stamp))
    _write_csv(
        bal_path,
        ["Ledger Name", "Group", "Closing (as Tally sent it)", "Closing (number)",
         "Opening (as Tally sent it)", "Opening (number)"],
        [[p["name"], p["group"], p["raw_closing"],
          "" if p["closing"] is None else p["closing"],
          p["raw_opening"], "" if p["opening"] is None else p["opening"]] for p in parties],
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
    nonzero = [p for p in parties if p["closing"]]
    total = sum(p["closing"] or 0 for p in parties)
    print("\n" + "=" * 66)
    print("  DONE — nothing was uploaded anywhere. Files written to:")
    print("    " + OUTPUT_DIR)
    print("      {}".format(os.path.basename(bal_path)))
    print("      {}   ({} lines)".format(os.path.basename(ent_path), len(entries)))
    print("      raw_balances_{0}.xml / raw_vouchers_{0}.xml".format(stamp))
    print("=" * 66)
    print("  Party ledgers ............ {}".format(len(parties)))
    print("  With a non-zero balance .. {}".format(len(nonzero)))
    print("  Statement lines .......... {}".format(len(entries)))
    if skipped:
        print("  Vouchers whose party movement couldn't be read: {}".format(skipped))
    print("  Sum of closing balances .. {:,.2f}   (negate: {:,.2f})".format(total, -total))
    print("-" * 66)
    print("  CHECK THESE 3 IN TALLY — do the amounts and the direction match?")
    for p in sorted(nonzero, key=lambda r: -abs(r["closing"]))[:3]:
        print("    {:<34} {:>14}".format(p["name"][:34], p["raw_closing"]))
    print("\n  If a shop that OWES you money shows a minus sign above, tell us —")
    print("  the app flips the sign once, centrally, and everything follows.")
    print("=" * 66)


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, socket.timeout, ConnectionError) as exc:
        print("\n  Could not reach Tally at {}.".format(TALLY_URL))
        print("  Is TallyPrime open, with the company loaded and the XML server")
        print("  (port 9000) switched on?  See README.md.")
        print("  Technical detail: {}".format(exc))
    except ET.ParseError as exc:
        print("\n  Tally answered, but the reply could not be read as XML.")
        print("  The raw reply was still saved in {} — send it over.".format(OUTPUT_DIR))
        print("  Technical detail: {}".format(exc))
    except Exception as exc:  # noqa: BLE001 - operator-facing, never a traceback
        print("\n  Something went wrong: {}".format(exc))
        print("  Nothing was changed in Tally (this script only ever reads).")
    input("\n  Press Enter to close ...")
