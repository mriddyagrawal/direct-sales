# -*- coding: utf-8 -*-
# =============================================================================
#  Ganpati — Tally retailer sync  (READ-ONLY)   ·   the one file to run
# =============================================================================
#  Replaces running credit_export.py and ledger_statement_export.py separately.
#  One pass over Tally produces the two things the app needs, and then CHECKS
#  THEM AGAINST EACH OTHER before you trust either:
#
#     1. balances   — what each shop owes, as at the window's start and end
#     2. statement  — the bills and receipts in between
#     3. reconcile  — per shop:  sum(statement)  ==  closing - opening ?
#
#  Step 3 is the point. Agreement to the paisa pins down direction, magnitude,
#  completeness and window alignment in one shot. Disagreement is reported per
#  shop, loudly, instead of shipping numbers that merely look plausible.
#
#  READ-ONLY, structurally: only TALLYREQUEST=Export is ever built. No Import,
#  no Alter, no Create, no <IMPORTDATA>, no <TALLYMESSAGE> payload — anywhere.
#
#  Python 3, standard library only. Double-click run-ledger-sync.bat.
# =============================================================================

import csv
import html
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime

# -----------------------------------------------------------------------------
#  CONFIG
# -----------------------------------------------------------------------------
TALLY_URL = "http://localhost:9000"

# Leave "" to use whichever company is open. Set it once the name is known:
# a wrong RDP session then exports the wrong book with NO error anywhere, and
# every balance in the app silently becomes last year's.
COMPANY = ""

OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "GanpatiSync")

# Window: this many whole months back, starting at the 1st of that month.
WINDOW_MONTHS = 2

# Top group the shops live under; everything beneath it counts, however deep.
# "" takes every ledger (slow, but nothing can be missed).
ROOT_GROUP = "Sundry Debtors"

# One request per month keeps each reply small; Tally builds the whole answer in
# memory and dies somewhere north of ~512 MB.
CHUNK_MONTHS = 1

TIMEOUT_QUICK = 60      # groups, names, company
TIMEOUT_BALANCES = 600
TIMEOUT_ENTRIES = 900

# Reconciliation tolerance, in rupees. Rounding in Tally is to the paisa, so
# anything above a few paise is a real disagreement, not float noise.
TOLERANCE = 1.00
# -----------------------------------------------------------------------------


def _window():
    today = date.today()
    y, m = today.year, today.month - WINDOW_MONTHS
    while m <= 0:
        y, m = y - 1, m + 12
    start = date(y, m, 1)
    return start, today


WIN_FROM, WIN_TO = _window()
OPEN_ASOF = date.fromordinal(WIN_FROM.toordinal() - 1)   # the day before = opening
CLOSE_ASOF = WIN_TO


def _fy_start(d):
    """1 April of the financial year containing `d`."""
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _company_tag():
    return "<SVCURRENTCOMPANY>{}</SVCURRENTCOMPANY>".format(_esc(COMPANY)) if COMPANY else ""


# =============================================================================
#  REQUESTS
# =============================================================================
# A Collection export — Tally's own object XML. Used for the small master
# pulls (groups, ledger names, balances) where the payload is modest and the
# native shape is convenient. $$SysName:XML is the correct format HERE.
_COLL = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>{cid}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE>{cmp}
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>{coll}</TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>"""


def _coll(cid, frm, to, body):
    return _COLL.format(cid=cid, frm=frm, to=to, cmp=_company_tag(), coll=body)


GROUPS_XML = _coll("GroupTree", WIN_FROM.strftime("%Y%m%d"), WIN_TO.strftime("%Y%m%d"), """
      <COLLECTION NAME="GroupTree" ISMODIFY="No"><TYPE>Group</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>""")

NAMES_XML = _coll("LedgerNames", WIN_FROM.strftime("%Y%m%d"), WIN_TO.strftime("%Y%m%d"), """
      <COLLECTION NAME="LedgerNames" ISMODIFY="No"><TYPE>Ledger</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>
      </COLLECTION>""")


def balances_xml(asof, scoped=True):
    """Balances AS AT `asof`.

    Two requests at two dates, NOT one request reading OpeningBalance and
    ClosingBalance: $OpeningBalance is the BOOK's opening (start of the
    financial year) and does not move with SVFROMDATE. Measured on the real
    company 2026-07-31 — opening equalled closing on 393 of 393 non-zero
    ledgers, so 'movement' was structurally zero and the reconciliation below
    had nothing to test. SVTODATE is what makes ClosingBalance mean "as at".
    """
    child = "<CHILDOF>$$GroupSundryDebtors</CHILDOF><BELONGSTO>Yes</BELONGSTO>" if scoped else ""
    return _coll("PartyBalances", _fy_start(asof).strftime("%Y%m%d"), asof.strftime("%Y%m%d"), """
      <COLLECTION NAME="PartyBalances" ISMODIFY="No"><TYPE>Ledger</TYPE>
        {child}
        <NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>Parent</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
      </COLLECTION>""".format(child=child))


# ---- the statement: a REPORT export, one row per ledger entry ---------------
# Fields are emitted under 3-character tags (F01...) instead of Tally's verbose
# native XML: measured 349 KB vs 17 MB for the same window.
FIELDS = [
    ("date",         '$$PyrlYYYYMMDDFormat:$Date:"-"'),
    ("voucher_type", "$VoucherTypeName"),
    ("voucher_no",   "$VoucherNumber"),
    ("ledger",       "$LedgerName"),
    # Production form from tally-database-loader. An earlier attempt that
    # wrapped $$NumValue in $$String returned EMPTY on all 15,545 rows — do not
    # "simplify" this.
    ("amount",       '$$StringFindAndReplace:(if $$IsDebit:$Amount then -$$NumValue:$Amount '
                     'else $$NumValue:$Amount):"(-)":"-"'),
    ("amount_raw",   "$Amount"),      # audit column; saved the money once already
    ("is_debit",     "if $$IsDebit:$Amount then 1 else 0"),
    ("guid",         "$Guid"),
]
VOUCHER_FETCH = "Date,VoucherTypeName,VoucherNumber,Guid"


def entries_xml(frm, to):
    """One row per ledger entry across every voucher in [frm, to]."""
    n = len(FIELDS)
    fields = "".join('<FIELD NAME="Fld{i:02d}"><SET>{e}</SET><XMLTAG>F{i:02d}</XMLTAG></FIELD>'
                     .format(i=i + 1, e=_esc(expr)) for i, (_, expr) in enumerate(FIELDS))
    fields += '<FIELD NAME="FldBlank"><SET>""</SET></FIELD>'
    names = ",".join("Fld{:02d}".format(i + 1) for i in range(n))
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>"
        "<TYPE>Data</TYPE><ID>GanpatiLedgerReport</ID></HEADER><BODY><DESC><STATICVARIABLES>"
        # "XML (Data Interchange)" — NOT $$SysName:XML, which is right for a
        # Collection export but yields nothing from a REPORT. And not comma
        # format, which silently DROPS empty fields and shifts every column.
        "<SVEXPORTFORMAT>XML (Data Interchange)</SVEXPORTFORMAT>"
        "<SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE>{cmp}"
        "</STATICVARIABLES><TDL><TDLMESSAGE>"
        '<REPORT NAME="GanpatiLedgerReport"><FORMS>MyForm</FORMS></REPORT>'
        '<FORM NAME="MyForm"><PARTS>MyPart01</PARTS></FORM>'
        '<PART NAME="MyPart01"><LINES>MyLine01</LINES><REPEAT>MyLine01 : MyCollection</REPEAT>'
        "<SCROLLED>Vertical</SCROLLED></PART>"
        '<PART NAME="MyPart02"><LINES>MyLine02</LINES><REPEAT>MyLine02 : AllLedgerEntries</REPEAT>'
        "<SCROLLED>Vertical</SCROLLED></PART>"
        '<LINE NAME="MyLine01"><FIELDS>FldBlank</FIELDS><EXPLODE>MyPart02</EXPLODE></LINE>'
        '<LINE NAME="MyLine02"><FIELDS>{names}</FIELDS></LINE>'
        "{fields}"
        # AllLedgerEntries MUST appear in FETCH or the explode yields the right
        # number of completely empty rows — 4,862 <FLDBLANK/> and nothing else.
        '<COLLECTION NAME="MyCollection"><TYPE>Voucher</TYPE>'
        "<FETCH>{vf},AllLedgerEntries</FETCH>"
        "<FILTER>Fltr01,Fltr02</FILTER></COLLECTION>"
        '<SYSTEM TYPE="Formulae" NAME="Fltr01">NOT $IsCancelled</SYSTEM>'
        '<SYSTEM TYPE="Formulae" NAME="Fltr02">NOT $IsOptional</SYSTEM>'
        "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
    ).format(frm=frm, to=to, cmp=_company_tag(), names=names, fields=fields, vf=VOUCHER_FETCH)


# Ledger balances via the REPORT engine rather than a Collection export.
# WHY: measured 2026-07-31 on the real company - a Collection export's
# ClosingBalance IGNORES SVTODATE: asking "as at 30 Apr" and "as at 31 Jul"
# returned byte-identical 1,143 KB replies and 0 of 2,976 ledgers moved. The
# same run's voucher REPORT *did* honour the period (three monthly chunks, three
# different sizes), so the report engine is date-aware where the collection is
# not. Same fields, different engine.
BAL_FIELDS = [
    ("name",    "$Name"),
    ("parent",  "$Parent"),
    # NO $$String: wrapper. $$String:$$NumValue:... evaluates to NOTHING in TDL -
    # the same mistake cost the other session a whole debugging round on the
    # amount field, and I reintroduced it here. The raw column sits beside it so
    # a repeat failure is visible in the file instead of silently becoming 0.
    # Mirrors the statement's amount expression EXACTLY, so both halves of the
    # pipeline use one rule: negative = debit = owed to us. Without the negation
    # the report returns debit-POSITIVE, and every shop reconciles as an exact
    # sign mirror (measured 2026-07-31 05:00: 348 mismatches, all mirrored).
    ("balance", '$$StringFindAndReplace:(if $$IsDebit:$ClosingBalance then -$$NumValue:$ClosingBalance '
                'else $$NumValue:$ClosingBalance):"(-)":"-"'),
    ("balance_raw", "$ClosingBalance"),
]


def balances_report_xml(asof, scoped=True):
    n = len(BAL_FIELDS)
    fields = "".join('<FIELD NAME="Fld{i:02d}"><SET>{e}</SET><XMLTAG>F{i:02d}</XMLTAG></FIELD>'
                     .format(i=i + 1, e=_esc(expr)) for i, (_, expr) in enumerate(BAL_FIELDS))
    names = ",".join("Fld{:02d}".format(i + 1) for i in range(n))
    child = "<CHILDOF>$$GroupSundryDebtors</CHILDOF><BELONGSTO>Yes</BELONGSTO>" if scoped else ""
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>"
        "<TYPE>Data</TYPE><ID>GanpatiBalReport</ID></HEADER><BODY><DESC><STATICVARIABLES>"
        "<SVEXPORTFORMAT>XML (Data Interchange)</SVEXPORTFORMAT>"
        "<SVFROMDATE>{frm}</SVFROMDATE><SVTODATE>{to}</SVTODATE>{cmp}"
        "</STATICVARIABLES><TDL><TDLMESSAGE>"
        '<REPORT NAME="GanpatiBalReport"><FORMS>BalForm</FORMS></REPORT>'
        '<FORM NAME="BalForm"><PARTS>BalPart</PARTS></FORM>'
        '<PART NAME="BalPart"><LINES>BalLine</LINES><REPEAT>BalLine : BalColl</REPEAT>'
        "<SCROLLED>Vertical</SCROLLED></PART>"
        '<LINE NAME="BalLine"><FIELDS>{names}</FIELDS></LINE>{fields}'
        '<COLLECTION NAME="BalColl"><TYPE>Ledger</TYPE>{child}'
        "<FETCH>Name,Parent,ClosingBalance</FETCH></COLLECTION>"
        "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
    ).format(frm=_fy_start(asof).strftime("%Y%m%d"), to=asof.strftime("%Y%m%d"),
             cmp=_company_tag(), names=names, fields=fields, child=child)


def parse_balance_report(raw, family):
    """Rows of <F01>name</F01><F02>parent</F02><F03>balance</F03>."""
    txt = sanitize(raw)
    if "<LINEERROR>" in txt:
        e = re.search(r"<LINEERROR>(.*?)</LINEERROR>", txt, re.S)
        raise RuntimeError("Tally rejected the balance report: " + (e.group(1).strip() if e else "?"))
    for i in range(len(BAL_FIELDS)):
        txt = txt.replace("<F{:02d}/>".format(i + 1), "<F{0:02d}></F{0:02d}>".format(i + 1))
    pat = "".join(r"<F{0:02d}>(.*?)</F{0:02d}>\s*".format(i + 1) for i in range(len(BAL_FIELDS)))
    out = {}
    empties = 0
    for name, parent, bal, bal_raw in re.findall(pat, txt, re.S):
        name = html.unescape(name).strip()
        parent = html.unescape(parent).strip()
        if not name or (family is not None and parent.lower() not in family):
            continue
        val = to_number(bal, html.unescape(bal_raw))
        if val is None:
            empties += 1
        out[name.lower()] = {"name": name, "group": parent, "balance": val}
    if out and empties == len(out):
        # every balance unreadable means the field expression is wrong, not that
        # the shops are all square. Say so instead of returning a page of zeros.
        raise RuntimeError("balance report gave {} rows but NO readable balances "
                           "- field expression is wrong".format(len(out)))
    return out


COMPANY_XML = ("<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>"
               "<TYPE>Collection</TYPE><ID>Cmp</ID></HEADER><BODY><DESC>"
               "<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" + _company_tag() +
               "</STATICVARIABLES><TDL><TDLMESSAGE>"
               '<COLLECTION NAME="Cmp"><TYPE>Company</TYPE><NATIVEMETHOD>Name</NATIVEMETHOD>'
               "<FILTER>CmpActive</FILTER></COLLECTION>"
               '<SYSTEM TYPE="Formulae" NAME="CmpActive">$$IsEqual:$Name:##SVCurrentCompany</SYSTEM>'
               "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>")


# =============================================================================
#  TRANSPORT + PARSING
# =============================================================================
class _Ticker(object):
    """Tally reports no progress of its own, so a slow-but-healthy pull and a
    hang look identical. This makes them distinguishable."""

    def __init__(self, label):
        self.label, self._stop, self._bytes = label, threading.Event(), 0
        self._t0 = time.time()
        self._th = threading.Thread(target=self._run); self._th.daemon = True

    def _run(self):
        while not self._stop.wait(2.0):
            got = "{:,} KB".format(self._bytes // 1024) if self._bytes else "waiting for Tally"
            sys.stdout.write("\r   {} ... {}s  {}    ".format(self.label, int(time.time() - self._t0), got))
            sys.stdout.flush()

    def start(self): self._th.start(); return self
    def add(self, n): self._bytes += n

    def done(self):
        self._stop.set(); self._th.join(timeout=1)
        sys.stdout.write("\r   {} ... {:.1f}s  {:,} KB          \n".format(
            self.label, time.time() - self._t0, self._bytes // 1024))
        sys.stdout.flush()


def post(xml, label, timeout):
    t = _Ticker(label).start()
    try:
        req = urllib.request.Request(TALLY_URL, data=xml.encode("utf-8"),
                                     headers={"Content-Type": "text/xml;charset=utf-8"})
        chunks = []
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            while True:
                c = resp.read(65536)
                if not c:
                    break
                chunks.append(c); t.add(len(c))
        return b"".join(chunks)
    finally:
        t.done()


_BARE_AMP = re.compile(rb"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")
_BAD_REF = re.compile(r"&#(?:x([0-9a-fA-F]+)|(\d+));")


def _drop_illegal_ref(m):
    code = int(m.group(1), 16) if m.group(1) else int(m.group(2))
    return m.group(0) if code in (0x09, 0x0A, 0x0D) or code >= 0x20 else " "


def sanitize(raw):
    """Tally emits three different things a strict parser rejects:
       · bare '&' inside text (half the shops here are 'X & Sons')
       · raw control bytes left over from Windows-1252
       · ESCAPED control characters, e.g. <PARENT>&#4; Primary</PARENT> — which
         XML forbids even in escaped form, and which killed a 1.1 MB reply at
         line 19498 on the real company.
    """
    txt = _BARE_AMP.sub(b"&amp;", raw).decode("utf-8", errors="replace")
    txt = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", txt)
    return _BAD_REF.sub(_drop_illegal_ref, txt)


def _text(el, tag):
    c = el.find(tag)
    return (c.text or "").strip() if c is not None and c.text else ""


def _name_of(el):
    return (el.get("NAME") or "").strip() or _text(el, "NAME")


def parse_groups(raw):
    root = ET.fromstring(sanitize(raw))
    return {_name_of(g).lower(): _text(g, "PARENT").strip().lower()
            for g in root.iter("GROUP") if _name_of(g)}


def family_of(tree, root_name):
    """Groups that ARE root_name or sit anywhere beneath it. Walks upward per
    group, so the order Tally returns them in does not matter."""
    root_name = (root_name or "").strip().lower()
    if not root_name:
        return None
    fam = {root_name}
    for g in tree:
        seen, cur = set(), g
        while cur and cur not in seen:
            seen.add(cur)
            if cur == root_name:
                fam.add(g); break
            cur = tree.get(cur)
    return fam


def parse_ledgers(raw, family, with_balance):
    root = ET.fromstring(sanitize(raw))
    out, groups = {}, {}
    for led in root.iter("LEDGER"):
        name = _name_of(led)
        if not name:
            continue
        parent = _text(led, "PARENT")
        groups[parent] = groups.get(parent, 0) + 1
        if family is not None and parent.strip().lower() not in family:
            continue
        rec = {"name": name, "group": parent}
        if with_balance:
            rec["balance"] = _amount(_text(led, "CLOSINGBALANCE"))
        out[name.strip().lower()] = rec
    return out, groups


def _amount(raw):
    """Signed rupees from a Tally balance string. The sign is left EXACTLY as
    Tally sent it — negative means debit, i.e. money owed to us."""
    if not raw:
        return None
    s = raw.replace(",", "").strip()
    m = re.search(r"-?\d+(\.\d+)?", s)
    if not m:
        return None
    v = float(m.group(0))
    if re.search(r"\bCr\b", s, re.I):
        v = -abs(v)
    elif re.search(r"\bDr\b", s, re.I):
        v = abs(v)
    return v


def parse_entries(raw):
    """Rows arrive as <F01>..</F01>...<F08>..</F08>, repeated."""
    txt = sanitize(raw)
    if "<LINEERROR>" in txt:
        e = re.search(r"<LINEERROR>(.*?)</LINEERROR>", txt, re.S)
        raise RuntimeError("Tally rejected the request: " + (e.group(1).strip() if e else "?"))
    n = len(FIELDS)
    for i in range(n):
        txt = txt.replace("<F{:02d}/>".format(i + 1), "<F{0:02d}></F{0:02d}>".format(i + 1))
    pat = "".join(r"<F{0:02d}>(.*?)</F{0:02d}>\s*".format(i + 1) for i in range(n))
    cols = [c for c, _ in FIELDS]
    return [dict(zip(cols, [html.unescape(g).strip() for g in m]))
            for m in re.findall(pat, txt, re.S)]


def to_number(numeric, raw):
    """SIGNED value of a leg: negative = debit. Never take abs() — a discount
    posts as is_debit=0 with amount -45 ("a credit of minus 45"), which is a
    debit in effect; trusting the label breaks such vouchers by twice the
    discount. Returns None if neither column parses, so failures get COUNTED
    rather than silently written as zero."""
    for candidate in (numeric, raw):
        if not candidate:
            continue
        s = candidate.replace(",", "").replace("(-)", "-").strip()
        m = re.search(r"-?\d+(\.\d+)?", s)
        if m:
            v = float(m.group(0))
            if candidate is raw:
                if re.search(r"\bCr\b", s, re.I):
                    v = abs(v)
                elif re.search(r"\bDr\b", s, re.I):
                    v = -abs(v)
            return v
    return None


def month_chunks(start, end, months):
    out, cur = [], start
    while cur <= end:
        y, m = cur.year, cur.month + months
        y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
        nxt = date(y, m, 1)
        out.append((cur.strftime("%Y%m%d"),
                    min(end, date.fromordinal(nxt.toordinal() - 1)).strftime("%Y%m%d")))
        cur = nxt
    return out


def inr(n):
    neg, n = n < 0, abs(int(round(n)))
    s = str(n)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "Rs " + s


# =============================================================================
#  MAIN
# =============================================================================
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    dump = lambda n, b: open(os.path.join(OUTPUT_DIR, "raw_{}_{}.xml".format(n, stamp)), "wb").write(b)

    print("Ganpati - Tally sync (READ-ONLY)")
    print("Window   : {} to {}".format(WIN_FROM, WIN_TO))
    print("Balances : opening as at {} · closing as at {}".format(OPEN_ASOF, CLOSE_ASOF))
    print("Saving   : {}\n".format(OUTPUT_DIR))

    # -- 0. which company is Tally actually serving? --------------------------
    try:
        served = re.search(r"<NAME>(.*?)</NAME>", sanitize(post(COMPANY_XML, "company", TIMEOUT_QUICK)), re.S)
        print("   Company: {}  [{}]\n".format(
            html.unescape(served.group(1)).strip() if served else "unknown",
            "pinned" if COMPANY else "whatever is open"))
    except Exception as exc:
        print("   Company: could not be read ({})\n".format(exc))

    # -- 1. group tree --------------------------------------------------------
    print("Step 1/5  group tree")
    raw = post(GROUPS_XML, "groups", TIMEOUT_QUICK); dump("groups", raw)
    tree = parse_groups(raw)
    fam = family_of(tree, ROOT_GROUP)
    print("   {:,} groups; {:,} are '{}' or beneath it\n".format(
        len(tree), len(fam) if fam else len(tree), ROOT_GROUP or "everything"))

    # -- 2. ledger names ------------------------------------------------------
    print("Step 2/5  shop list")
    raw = post(NAMES_XML, "names", TIMEOUT_QUICK); dump("names", raw)
    shops, groups_seen = parse_ledgers(raw, fam, with_balance=False)
    print("   {:,} ledgers in the company; {:,} are shops\n".format(sum(groups_seen.values()), len(shops)))
    if not shops:
        print("   Nothing under '{}'. Groups seen:".format(ROOT_GROUP))
        for g, n in sorted(groups_seen.items(), key=lambda kv: -kv[1])[:15]:
            print("     {:<44} {}".format((g or "(blank)")[:44], n))
        return

    # -- 3. balances at two dates --------------------------------------------
    print("Step 3/5  balances")

    def _pair(fetcher, label):
        c = fetcher(CLOSE_ASOF, "closing " + label)
        o = fetcher(OPEN_ASOF, "opening " + label)
        n = sum(1 for k, v in c.items()
                if v.get("balance") is not None and o.get(k, {}).get("balance") is not None
                and abs(v["balance"] - o[k]["balance"]) > 0.005)
        return c, o, n

    def _via_report(asof, label):
        raw = post(balances_report_xml(asof), label, TIMEOUT_BALANCES)
        dump("bal_report_" + label.split()[0], raw)
        try:
            return parse_balance_report(raw, fam)
        except RuntimeError as exc:
            print("   {}".format(exc))
            return {}

    def _via_collection(asof, label):
        raw = post(balances_xml(asof), label, TIMEOUT_BALANCES)
        dump("bal_coll_" + label.split()[0], raw)
        rows, _ = parse_ledgers(raw, fam, with_balance=True)
        if not rows:
            raw = post(balances_xml(asof, scoped=False), label + " (all)", TIMEOUT_BALANCES)
            rows, _ = parse_ledgers(raw, fam, with_balance=True)
        return rows

    # The REPORT engine first: it provably honours SVFROMDATE/SVTODATE (the
    # voucher pull returns different data per month), whereas a Collection
    # export's ClosingBalance ignored the as-at date entirely on this company.
    closing, opening, moved = _pair(_via_report, "(report)")
    engine = "report"
    if closing and not moved:
        print("   report engine gave no movement either - trying the collection engine")
        closing2, opening2, moved2 = _pair(_via_collection, "(collection)")
        if moved2:
            closing, opening, moved, engine = closing2, opening2, moved2, "collection"
        elif not closing:
            closing, opening = closing2, opening2

    print("   {:,} shops priced via the {} engine; {:,} moved between the two dates".format(
        len(closing), engine, moved))
    dated = moved > 0
    if closing and not dated:
        print("   !! Neither engine honours the as-at date on this Tally, so there is no")
        print("   !! INDEPENDENT opening balance. Opening will be DERIVED from the")
        print("   !! statement below, which makes the cross-check circular - it is")
        print("   !! skipped rather than reported as a pass.")
    print()

    # -- 4. the statement -----------------------------------------------------
    print("Step 4/5  statement")
    chunks = month_chunks(WIN_FROM, WIN_TO, CHUNK_MONTHS)
    per_ledger, kept, all_legs, blanks = {}, [], 0, 0
    voucher_sums = {}
    for frm, to in chunks:
        raw = post(entries_xml(frm, to), "entries {}".format(frm[:6]), TIMEOUT_ENTRIES)
        dump("entries_{}".format(frm[:6]), raw)
        rows = parse_entries(raw)
        all_legs += len(rows)
        for r in rows:
            amt = to_number(r["amount"], r["amount_raw"])
            if amt is None:
                blanks += 1
                continue
            # completeness check runs over EVERY leg, before filtering to shops
            voucher_sums[r["guid"]] = voucher_sums.get(r["guid"], 0.0) + amt
            k = r["ledger"].strip().lower()
            if k not in shops:
                continue
            r["amount_signed"] = amt
            kept.append(r)
            per_ledger[k] = per_ledger.get(k, 0.0) + amt
    unbalanced = sum(1 for v in voucher_sums.values() if abs(v) > 0.005)
    print("   {:,} legs in the window; {:,} belong to shops".format(all_legs, len(kept)))
    print("   {:,} vouchers, {:,} of which do not balance{}".format(
        len(voucher_sums), unbalanced, "  <-- investigate" if unbalanced else " (good)"))
    if blanks:
        print("   !! {:,} legs had no readable amount".format(blanks))
    print()

    # -- 5. THE CHECK ---------------------------------------------------------
    ok, bad, untestable = [], [], 0
    if dated:
        print("Step 5/5  reconciliation:  sum(statement)  ==  closing - opening ?")
        for k, shop in closing.items():
            c, o = shop.get("balance"), opening.get(k, {}).get("balance")
            if c is None or o is None:
                untestable += 1
                continue
            expected, actual = c - o, per_ledger.get(k, 0.0)
            (ok if abs(expected - actual) <= TOLERANCE else bad).append((shop["name"], expected, actual))
        total = len(ok) + len(bad)
        print("   reconciled : {:,} of {:,}{}".format(len(ok), total,
              "  ({:.1f}%)".format(100.0 * len(ok) / total) if total else ""))
        mirrored = sum(1 for _, e, a in bad if abs(e + a) <= TOLERANCE and abs(e) > TOLERANCE)
        if bad and mirrored >= max(3, len(bad) // 2):
            print("   !! {:,} of {:,} mismatches are EXACT SIGN MIRRORS.".format(mirrored, len(bad)))
            print("   !! That is one convention disagreeing with the other, not bad data:")
            print("   !! the balances and the statement are describing the same movements")
            print("   !! with opposite signs. Fix the expression, not the figures.")
        if bad:
            print("   MISMATCHED : {:,}   worst:".format(len(bad)))
            for n, e, a in sorted(bad, key=lambda t: -abs(t[1] - t[2]))[:8]:
                print("      {:<34} expected {:>14}  got {:>14}".format(n[:34], inr(e), inr(a)))
        if untestable:
            print("   untestable : {:,} (no balance at one of the two dates)".format(untestable))
    else:
        # Derive the opening so the files are still usable, and be explicit that
        # this is arithmetic, not a second opinion.
        print("Step 5/5  opening DERIVED (closing - statement); cross-check not possible")
        for k, shop in closing.items():
            c = shop.get("balance")
            if c is None:
                continue
            opening[k] = {"balance": c - per_ledger.get(k, 0.0)}
        unbal = sum(1 for v in voucher_sums.values() if abs(v) > 0.005)
        print("   the only independent evidence is the statement itself:")
        print("   {:,} of {:,} vouchers balance to zero{}".format(
            len(voucher_sums) - unbal, len(voucher_sums), " - complete and self-consistent" if not unbal else ""))
    print()

    # -- write the two files --------------------------------------------------
    bal_path = os.path.join(OUTPUT_DIR, "balances_{}.csv".format(stamp))
    with open(bal_path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["ledger_name", "group", "outstanding", "opening", "closing",
                    "movement", "opening_as_at", "closing_as_at", "reconciled"])
        recon = {n for n, _, _ in ok}
        for k, shop in sorted(closing.items()):
            c, o = shop.get("balance"), opening.get(k, {}).get("balance")
            # `outstanding` is the app-facing number: POSITIVE means the shop
            # owes us. Tally sends a receivable as negative, so it is flipped
            # here, once, and `closing` keeps Tally's own sign for audit.
            w.writerow([shop["name"], shop["group"],
                        "" if c is None else round(-c, 2),
                        "" if o is None else round(o, 2),
                        "" if c is None else round(c, 2),
                        "" if (c is None or o is None) else round(c - o, 2),
                        OPEN_ASOF.isoformat(), CLOSE_ASOF.isoformat(),
                        "yes" if shop["name"] in recon else ("no" if c is not None and o is not None else "")])

    ent_path = os.path.join(OUTPUT_DIR, "statement_{}.csv".format(stamp))
    with open(ent_path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["ledger_name", "date", "voucher_type", "voucher_no", "debit", "credit", "amount_tally"])
        for r in sorted(kept, key=lambda r: (r["ledger"].lower(), r["date"])):
            amt = r["amount_signed"]
            # split on the SIGN, never on is_debit — see to_number()
            w.writerow([r["ledger"], r["date"], r["voucher_type"], r["voucher_no"],
                        round(-amt, 2) if amt < 0 else "", round(amt, 2) if amt > 0 else "", round(amt, 2)])

    print("=" * 68)
    print("  balances  -> {}   ({:,} shops)".format(os.path.basename(bal_path), len(closing)))
    print("  statement -> {}   ({:,} lines)".format(os.path.basename(ent_path), len(kept)))
    owed = [-s["balance"] for s in closing.values() if s.get("balance") and s["balance"] < 0]
    print("  {:,} shops owe {} in total".format(len(owed), inr(sum(owed))))
    print("=" * 68)
    if not dated:
        print("  USABLE, BUT UNVERIFIED - opening is derived, so the two files cannot")
        print("  disagree with each other by construction. Balances and statement are")
        print("  each individually sound; their agreement is not evidence.")
    elif bad:
        print("  NOT SAFE TO LOAD YET - {} shops do not reconcile (see above).".format(len(bad)))
    elif ok:
        print("  All {} testable shops reconcile. The two files agree with each other.".format(len(ok)))


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.URLError, socket.timeout, ConnectionError) as exc:
        print("\n\n  Could not reach Tally at {}.".format(TALLY_URL))
        print("  Is TallyPrime open, company loaded, XML server on (port 9000)?")
        print("  Detail: {}".format(exc))
    except ET.ParseError as exc:
        print("\n\n  Tally answered but the reply would not parse. Raw files are in")
        print("  {} - send them over. Detail: {}".format(OUTPUT_DIR, exc))
    except Exception as exc:  # noqa: BLE001 - operator-facing, never a traceback
        print("\n\n  Something went wrong: {}".format(exc))
        print("  Nothing was changed in Tally (this script only ever reads).")
    if sys.stdin and sys.stdin.isatty():
        input("\n  Press Enter to close ...")
