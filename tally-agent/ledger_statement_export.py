# -*- coding: utf-8 -*-
# =============================================================================
#  Ganpati — Tally ledger statement export  (READ-ONLY)
# =============================================================================
#  Pulls one row per LEDGER ENTRY for every voucher in a date range:
#
#      date, ledger, voucher type, voucher number, amount, dr/cr
#
#  i.e. exactly the columns of Tally's own Ledger Vouchers screen, for EVERY
#  ledger at once, in a single pass over the vouchers.
#
#  WHY THIS SHAPE (this is the whole point of the file):
#    A ledger statement per ledger means asking Tally N times and making it walk
#    the voucher set N times - O(ledgers x vouchers). Instead this walks the
#    vouchers ONCE and explodes each voucher's ledger entries into flat rows.
#    Grouping by ledger is then free, in Python or SQL, off the CSV.
#
#  It is a REPORT-style export, not a Collection export. The difference matters:
#  a Collection export makes Tally emit its own verbose native XML for every
#  object; a REPORT with explicit <FIELD>/<XMLTAG> emits only the values asked
#  for, under 3-character tags. Same data, a fraction of the bytes, and far less
#  work for Tally.
#
#  READ-ONLY, structurally: only TALLYREQUEST=Export is ever built. There is no
#  Import, no Alter, no <IMPORTDATA>, no <TALLYMESSAGE> payload anywhere here.
#
#  Requirements: Python 3, standard library only.
#
#  HOW TO RUN IT: just double-click this file. It puts up a small menu, and the
#  window stays open at the end so you can read the result. No terminal needed.
#
#  From a command line, if you ever want to:
#     python ledger_statement_export.py                        last 2 months
#     python ledger_statement_export.py 2026-04-01 2027-03-31  explicit range
#     python ledger_statement_export.py --since-last           incremental
#     python ledger_statement_export.py --probe                capability check
#  With arguments, or when output is redirected, the menu and the closing pause
#  are both skipped — so this stays usable from a scheduled task.
# =============================================================================

import csv
import html
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime

# -----------------------------------------------------------------------------
#  CONFIG
# -----------------------------------------------------------------------------
TALLY_URL = "http://localhost:9000"
OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "GanpatiLedger")

# Chunk size. Tally builds the whole answer in memory before sending, and dies
# somewhere north of ~512 MB. One month per request keeps each answer small and
# means a failure costs you one month, not the whole pull. Raise to 3 or 12 for
# quiet years; drop to 1 for busy ones.
CHUNK_MONTHS = 1

# Default lookback when no dates are given. Same convention as credit_export.py:
# go back this many months, then start at the 1st of that month. So with 2, a run
# on 31-Jul covers 1-May -> 31-Jul (the two whole months back, plus this one).
DEFAULT_MONTHS_BACK = 2

# Seconds per chunk. A month of a busy company is seconds, not minutes, with
# this request shape - if you are hitting this, something is wrong.
TIMEOUT = 300

# Skip cancelled and optional vouchers server-side (Tally never builds the row).
EXCLUDE_CANCELLED = True
EXCLUDE_OPTIONAL = True

# Which sub-collection holds the ledger entries. Tally puts accounting-only
# vouchers (receipt/payment/journal) under LEDGERENTRIES and invoice-mode ones
# (sales/purchase with items) under ALLLEDGERENTRIES - and which one a given
# company uses varies. BOTH is correct and costs one extra pass; run --probe
# to see which actually carry rows for you, then narrow it if you like.
ENTRY_SOURCES = ["AllLedgerEntries", "LedgerEntries"]

# Written next to this script; holds the last AlterID seen, for --since-last.
#
# CAUTION on --since-last: AlterID rises when a voucher is created or edited,
# but a DELETED voucher simply stops existing — there is no tombstone and no
# AlterID bump to find. An incremental pull can therefore never learn that a
# voucher went away. Treat --since-last as a speed-up for ad-hoc exports only.
# Anything that feeds the app must re-pull the whole window and replace it, so
# that deletions disappear there too.
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ledger_state.txt")
# -----------------------------------------------------------------------------


# -- the fields we ask for, in order. (csv column, TDL expression) -------------
# Amount is emitted as BOTH a signed number and an explicit dr/cr flag on
# purpose: Tally's internal sign convention for debit is a thing people get
# wrong constantly, and $$IsDebit is unambiguous. Derive Debit/Credit columns
# from the flag, never from the sign.
FIELDS = [
    ("date",         '$$PyrlYYYYMMDDFormat:$Date:"-"'),
    ("voucher_type", "$VoucherTypeName"),
    ("voucher_no",   "$VoucherNumber"),
    ("ledger",       "$LedgerName"),
    ("amount",       '$$StringFindAndReplace:($$String:$$NumValue:$Amount):"(-)":"-"'),
    ("is_debit",     "if $$IsDebit:$Amount then 1 else 0"),
    ("party",        "$PartyLedgerName"),
    ("narration",    "$Narration"),
    ("guid",         "$Guid"),
    ("alter_id",     "$AlterID"),
]

# Voucher-level fields worth pre-loading so Tally does not re-resolve them per
# ledger entry. Keep this list tight - every name here is work.
VOUCHER_FETCH = "Date,VoucherTypeName,VoucherNumber,PartyLedgerName,Narration,Guid,AlterID"


def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def build_request(collection_route, from_date, to_date, fields, extra_filters=None):
    """A REPORT export over `collection_route` (e.g. 'Voucher.AllLedgerEntries').

    The route is split on '.'; each level becomes a PART that REPEATs over that
    level and EXPLODEs into the next. Only the innermost LINE carries FIELDs, so
    exactly one output row is produced per leaf object.
    """
    routes = collection_route.split(".")
    target = routes.pop(0)
    routes.insert(0, "MyCollection")

    parts, lines = "", ""
    for i, route in enumerate(routes):
        parts += (f'<PART NAME="MyPart{i+1:02d}"><LINES>MyLine{i+1:02d}</LINES>'
                  f'<REPEAT>MyLine{i+1:02d} : {route}</REPEAT><SCROLLED>Vertical</SCROLLED></PART>')
    for i in range(len(routes) - 1):
        lines += (f'<LINE NAME="MyLine{i+1:02d}"><FIELDS>FldBlank</FIELDS>'
                  f'<EXPLODE>MyPart{i+2:02d}</EXPLODE></LINE>')

    names = ",".join(f"Fld{i+1:02d}" for i in range(len(fields)))
    lines += f'<LINE NAME="MyLine{len(routes):02d}"><FIELDS>{names}</FIELDS></LINE>'

    field_xml = ""
    for i, (_, expr) in enumerate(fields):
        # short XMLTAG on purpose: 'F01' instead of Tally's native tag names is
        # a large share of the total payload once you are pulling 100k rows.
        field_xml += (f'<FIELD NAME="Fld{i+1:02d}"><SET>{_esc(expr)}</SET>'
                      f'<XMLTAG>F{i+1:02d}</XMLTAG></FIELD>')
    field_xml += '<FIELD NAME="FldBlank"><SET>""</SET></FIELD>'

    filters = list(extra_filters or [])
    if EXCLUDE_CANCELLED:
        filters.append("NOT $IsCancelled")
    if EXCLUDE_OPTIONAL:
        filters.append("NOT $IsOptional")

    filter_ref, filter_def = "", ""
    if filters:
        filter_ref = "<FILTER>" + ",".join(f"Fltr{j+1:02d}" for j in range(len(filters))) + "</FILTER>"
        for j, f in enumerate(filters):
            filter_def += f'<SYSTEM TYPE="Formulae" NAME="Fltr{j+1:02d}">{_esc(f)}</SYSTEM>'

    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>"
        "<TYPE>Data</TYPE><ID>GanpatiLedgerReport</ID></HEADER><BODY><DESC>"
        "<STATICVARIABLES>"
        # "XML (Data Interchange)" — NOT $$SysName:XML, which is the right value
        # for a Collection export but yields nothing useful from a REPORT export.
        # And not "ASCII (Comma Delimited)", which silently DROPS empty fields
        # instead of emitting an empty column, shifting every column after it.
        "<SVEXPORTFORMAT>XML (Data Interchange)</SVEXPORTFORMAT>"
        f"<SVFROMDATE>{from_date}</SVFROMDATE><SVTODATE>{to_date}</SVTODATE>"
        "</STATICVARIABLES><TDL><TDLMESSAGE>"
        '<REPORT NAME="GanpatiLedgerReport"><FORMS>MyForm</FORMS></REPORT>'
        '<FORM NAME="MyForm"><PARTS>MyPart01</PARTS></FORM>'
        f"{parts}{lines}{field_xml}"
        f'<COLLECTION NAME="MyCollection"><TYPE>{target}</TYPE>'
        f"<FETCH>{VOUCHER_FETCH}</FETCH>{filter_ref}</COLLECTION>{filter_def}"
        "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
    )


def post(xml, timeout=TIMEOUT):
    req = urllib.request.Request(
        TALLY_URL, data=xml.encode("utf-8"),
        headers={"Content-Type": "text/xml;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


_BAD = re.compile(rb"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")


def sanitize(raw):
    """Tally emits bare '&' and Windows-1252 bytes inside nominally-UTF-8 XML.
    A strict parser dies on real data; this makes it parseable without hiding
    anything we care about."""
    raw = _BAD.sub(b"&amp;", raw)
    return raw.decode("utf-8", errors="replace")


def parse(raw, fields):
    """Rows come back as <F01>..</F01><F02>..</F02> repeated. Regex rather than
    ElementTree: it is faster on 100 MB, and immune to whatever Tally does to
    the envelope on an error."""
    text = sanitize(raw)
    if "<LINEERROR>" in text:
        err = re.search(r"<LINEERROR>(.*?)</LINEERROR>", text, re.S)
        raise RuntimeError("Tally rejected the request: " + (err.group(1).strip() if err else "?"))

    n = len(fields)
    pattern = "".join(rf"<F{i+1:02d}>(.*?)</F{i+1:02d}>\s*" for i in range(n))
    # a field Tally considers empty is emitted as <F03/>; normalise those first
    for i in range(n):
        text = text.replace(f"<F{i+1:02d}/>", f"<F{i+1:02d}></F{i+1:02d}>")
    return [tuple(unescape(g).strip() for g in m) for m in re.findall(pattern, text, re.S)]


def unescape(s):
    """Entities back to characters. Ledger names really do contain '&' — half
    the shops in this company are 'X & Sons' — so this is not cosmetic.

    html.unescape rather than a chain of .replace() calls: it also decodes
    numeric refs (&#39; in a shop name), and gets the ordering right — replacing
    &amp; first would turn a literal '&amp;lt;' into '<'.
    """
    return html.unescape(s)


def month_chunks(start, end, months):
    """[(from,to), ...] as YYYYMMDD, inclusive, stepping `months` at a time."""
    out, cur = [], start
    while cur <= end:
        y, m = cur.year, cur.month + months
        y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
        nxt = date(y, m, 1)
        chunk_end = min(end, date.fromordinal(nxt.toordinal() - 1))
        out.append((cur.strftime("%Y%m%d"), chunk_end.strftime("%Y%m%d")))
        cur = nxt
    return out


def current_alter_id():
    """Company's highest voucher AlterID — the watermark for incremental pulls."""
    xml = ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>'
           '<TYPE>Collection</TYPE><ID>GanpatiAlt</ID></HEADER><BODY><DESC><TDL><TDLMESSAGE>'
           '<COLLECTION NAME="GanpatiAlt"><TYPE>Company</TYPE>'
           '<COMPUTE>IsActive : $$IsEqual:$Name:##SVCurrentCompany</COMPUTE>'
           '<FETCH>AltVchId,AltMstId</FETCH></COLLECTION>'
           "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>")
    m = re.search(r"<ALTVCHID>(\d+)</ALTVCHID>", sanitize(post(xml, 60)), re.I)
    return int(m.group(1)) if m else None


def probe(frm=None, to=None):
    """Escalating ladder: find the exact rung where it stops working.

    Step 1 proves Tally/company/date-range are fine using the plain Collection
    shape credit_export.py already relies on. Step 2 adds the REPORT wrapper.
    Step 3 adds the explode into ledger entries. Whichever step first returns
    nothing is the thing that is broken - and every reply is written to disk.
    """
    if not frm:
        today = date.today()
        y, mo = today.year, today.month - DEFAULT_MONTHS_BACK
        while mo <= 0:
            y, mo = y - 1, mo + 12
        frm, to = date(y, mo, 1).strftime("%Y%m%d"), today.strftime("%Y%m%d")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Probing {TALLY_URL} over {frm}..{to}")
    print(f"Raw replies -> {OUTPUT_DIR}\n")

    def keep(name, raw):
        p = os.path.join(OUTPUT_DIR, f"probe_{name}.xml")
        with open(p, "wb") as fh:
            fh.write(raw)
        return p

    # --- 1. plain Collection export: does Tally see ANY vouchers at all? ------
    coll = ('<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>'
            '<TYPE>Collection</TYPE><ID>GanpatiProbe</ID></HEADER><BODY><DESC>'
            '<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'
            f'<SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE></STATICVARIABLES>'
            '<TDL><TDLMESSAGE><COLLECTION NAME="GanpatiProbe" ISMODIFY="No">'
            '<TYPE>Voucher</TYPE><FETCH>Date,VoucherTypeName,VoucherNumber</FETCH>'
            "</COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>")
    try:
        raw = post(coll, 120)
        n = len(re.findall(r"<VOUCHER\b", sanitize(raw), re.I))
        print(f"  1. Collection/Voucher      {n:>6} vouchers  {len(raw):,} bytes  -> {keep('1_collection', raw)}")
        if not n:
            print("     ^ Tally sees no vouchers in this range at all. Wrong company loaded,")
            print("       or the range is genuinely empty. Nothing below can work until this does.")
    except Exception as e:
        print(f"  1. Collection/Voucher      FAILED {e}")

    # --- 2. REPORT wrapper, no explode ---------------------------------------
    flat = [("date", '$$PyrlYYYYMMDDFormat:$Date:"-"'), ("vtype", "$VoucherTypeName"),
            ("vno", "$VoucherNumber")]
    try:
        raw = post(build_request("Voucher", frm, to, flat), 120)
        rows = parse(raw, flat)
        print(f"  2. Report/Voucher          {len(rows):>6} rows      {len(raw):,} bytes  -> {keep('2_report', raw)}")
        if rows:
            print(f"     sample: {rows[0]}")
        elif len(raw) > 200:
            print(f"     ^ bytes came back but no <F01> tags — open the file above; the")
            print(f"       tag names in it tell us what to parse.")
    except Exception as e:
        print(f"  2. Report/Voucher          FAILED {e}")

    # --- 3. the real thing: explode into ledger entries ----------------------
    for src in ENTRY_SOURCES:
        try:
            raw = post(build_request(f"Voucher.{src}", frm, to, FIELDS), 120)
            rows = parse(raw, FIELDS)
            print(f"  3. Report/{src:16s} {len(rows):>6} rows      {len(raw):,} bytes  "
                  f"-> {keep('3_' + src, raw)}")
            if rows:
                print(f"     sample: {rows[0][:6]}")
        except Exception as e:
            print(f"  3. Report/{src:16s} FAILED {e}")

    print("\n  AlterID watermark:", current_alter_id())

    # Time-of-entry is NOT a standard voucher field. It exists only if Edit Log
    # / Tally Audit is switched on, and the name differs by version - so try
    # each candidate and let Tally tell us.
    print("\n  Looking for a time-of-entry field (none is standard):")
    for expr in ["$EnteredBy", "$AuditEntry", "$BasicVoucherTime", "$VoucherTime",
                 "$EnteredTime", "$LogDateTime", "$AlteredOn", "$$VchEntryTime"]:
        test = [("date", '$$PyrlYYYYMMDDFormat:$Date:"-"'), ("probe", expr)]
        try:
            rows = parse(post(build_request("Voucher", frm, to, test), 60), test)
            filled = sum(1 for r in rows if r[1])
            flag = "HAS VALUES" if filled else "exists, always empty"
            print(f"    {expr:20s} {flag}  ({filled}/{len(rows)} rows)")
        except Exception:
            print(f"    {expr:20s} not available")


def hold():
    """Double-clicked, the console closes the instant this returns and you never
    see the result. Wait for a keypress. Skipped when output is redirected, so
    scheduling it still works unattended."""
    if sys.stdin and sys.stdin.isatty():
        try:
            input("\nDone — press Enter to close this window.")
        except (EOFError, KeyboardInterrupt):
            pass


def menu():
    """Shown when the file is double-clicked (started with no arguments).
    Returns (args, flags) exactly as the command line would have supplied."""
    print("=" * 62)
    print("  Ganpati — Tally ledger statement export")
    print("=" * 62)
    print("\n  Make sure TallyPrime is open with the company loaded.\n")
    print("   1   Check the connection      (do this first, takes seconds)")
    print("   2   Export the last 2 months")
    print("   3   Export a date range you choose")
    print("   4   Quit\n")

    while True:
        choice = input("  Type 1, 2, 3 or 4 then press Enter: ").strip()
        if choice == "1":
            return [], {"--probe"}
        if choice == "2":
            return [], set()
        if choice == "3":
            while True:
                a = input("  From date (YYYY-MM-DD): ").strip()
                b = input("  To date   (YYYY-MM-DD): ").strip()
                try:
                    datetime.strptime(a, "%Y-%m-%d")
                    datetime.strptime(b, "%Y-%m-%d")
                    return [a, b], set()
                except ValueError:
                    print("  Dates must look like 2026-05-01. Try again.\n")
        if choice == "4":
            sys.exit(0)
        print("  Please type 1, 2, 3 or 4.\n")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    # no arguments at all = someone double-clicked the file
    if not sys.argv[1:] and sys.stdin and sys.stdin.isatty():
        args, flags = menu()
        print()

    if "--probe" in flags:
        if len(args) >= 2:
            probe(datetime.strptime(args[0], "%Y-%m-%d").strftime("%Y%m%d"),
                  datetime.strptime(args[1], "%Y-%m-%d").strftime("%Y%m%d"))
        else:
            probe()
        return

    if len(args) >= 2:
        start = datetime.strptime(args[0], "%Y-%m-%d").date()
        end = datetime.strptime(args[1], "%Y-%m-%d").date()
    else:
        end = date.today()
        y, m = end.year, end.month - DEFAULT_MONTHS_BACK
        while m <= 0:
            y, m = y - 1, m + 12
        start = date(y, m, 1)

    extra = []
    if "--since-last" in flags and os.path.exists(STATE_FILE):
        last = open(STATE_FILE).read().strip()
        if last.isdigit():
            extra.append(f"$AlterID > {last}")
            print(f"Incremental: only vouchers created or edited since AlterID {last}")
            print("  NOTE: deleted vouchers cannot appear in an incremental pull —")
            print("        do a full-window run before trusting this as complete.")

    watermark = current_alter_id()
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    out_path = os.path.join(OUTPUT_DIR, f"ledger_entries_{stamp}.csv")

    chunks = month_chunks(start, end, CHUNK_MONTHS)
    print(f"{start} -> {end}   {len(chunks)} chunk(s) x {len(ENTRY_SOURCES)} source(s)\n")

    total, seen = 0, set()
    with open(out_path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow([c for c, _ in FIELDS] + ["debit", "credit", "source"])
        for frm, to in chunks:
            for src in ENTRY_SOURCES:
                t0 = time.time()
                try:
                    raw = post(build_request(f"Voucher.{src}", frm, to, FIELDS, extra))
                except (urllib.error.URLError, OSError) as e:
                    print(f"  {frm}-{to} {src:18s} UNREACHABLE {e}")
                    continue
                try:
                    rows = parse(raw, FIELDS)
                except RuntimeError as e:
                    print(f"  {frm}-{to} {src:18s} {e}")
                    continue

                # Always keep the raw reply. When something is wrong this file is
                # the entire diagnosis, and it costs nothing to write.
                raw_path = os.path.join(OUTPUT_DIR, f"raw_{src}_{frm}.xml")
                with open(raw_path, "wb") as rf:
                    rf.write(raw)

                if not rows:
                    print(f"  {frm}-{to} {src:18s}      0 rows  {len(raw):,} bytes  "
                          f"{time.time()-t0:.1f}s")
                    if len(raw) > 200:
                        head = sanitize(raw)[:400].replace("\r", " ").replace("\n", " ")
                        print(f"      Tally sent {len(raw):,} bytes but no <F01> rows. Starts: {head}")
                        print(f"      full reply: {raw_path}")
                    continue

                kept = 0
                mine = set()
                for r in rows:
                    d = dict(zip([c for c, _ in FIELDS], r))
                    # Dedupe at VOUCHER level, never at row level. A voucher can
                    # surface under both sub-collections, so skip one we already
                    # emitted — but two identical lines to the same ledger inside
                    # ONE voucher are legitimate (a journal splitting an amount,
                    # one voucher settling two equal bills). Keying on
                    # (guid, ledger, amount) silently halves that money.
                    if d["guid"] in seen:
                        continue
                    mine.add(d["guid"])
                    try:
                        amt = abs(float(d["amount"] or 0))
                    except ValueError:
                        amt = 0.0
                    dr = amt if d["is_debit"] == "1" else ""
                    cr = "" if d["is_debit"] == "1" else amt
                    w.writerow(list(r) + [dr, cr, src])
                    kept += 1

                # only now, once every line of this source is written — adding
                # during the loop would drop a voucher's own later lines
                seen |= mine
                total += kept
                print(f"  {frm}-{to} {src:18s} {kept:>6} rows  "
                      f"{len(raw)/1048576:.1f} MB  {time.time()-t0:.1f}s")

    if watermark:
        with open(STATE_FILE, "w") as fh:
            fh.write(str(watermark))

    print(f"\n{total} ledger entries -> {out_path}")
    if watermark:
        print(f"AlterID watermark saved ({watermark}) — next run can use --since-last")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise                      # chose Quit — close straight away
    except urllib.error.URLError as e:
        print(f"\nCould not reach Tally at {TALLY_URL}.")
        print("  Check: TallyPrime is open, the company is loaded, and the XML")
        print("  server is on (F1 > Settings > Connectivity, port 9000).")
        print(f"  Technical detail: {e}")
        hold()
    except Exception as e:
        print(f"\nSomething went wrong: {e}")
        print("  The raw replies in the output folder show what Tally actually sent.")
        hold()
    else:
        hold()
