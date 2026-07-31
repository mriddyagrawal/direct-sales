# -*- coding: utf-8 -*-
# =============================================================================
#  Ganpati — reconcile the ledger export against the balances export
# =============================================================================
#  THE TEST THIS EXISTS FOR
#  ------------------------
#  For every ledger:   sum(signed amounts in the window)  ==  closing - opening
#
#  Both sides come from Tally but by completely different routes: the left from
#  ledger_statement_export.py walking vouchers, the right from credit_export.py
#  asking Tally for each ledger's own balances. If they agree to the paisa, then
#  in one shot this pins down:
#
#    * DIRECTION  - the sign convention is right (negative = debit). The
#                   voucher-level zero-sum check CANNOT establish this: it
#                   survives a global sign flip, so it proves completeness and
#                   internal consistency only.
#    * MAGNITUDE  - amounts are parsed correctly, not merely present
#    * COMPLETENESS - no legs missing from the extract
#    * WINDOW     - both exports really cover the same dates
#
#  A systematic sign error shows up unmistakably: every non-zero shop comes out
#  wrong by exactly twice its movement, i.e. delta == -(closing - opening).
#
#  READ-ONLY: touches two CSV files and never contacts Tally.
#
#  Usage:
#     python reconcile.py ledger_entries_<...>.csv credit_balances_<...>.csv
# =============================================================================

import csv
import re
import sys
from collections import defaultdict

TOLERANCE = 0.05          # paisa-level rounding is fine; anything more is not


def num(s):
    """'1,234.56' / '(-)45.00' / '-45' -> float. Empty or junk -> None."""
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    neg = "(-)" in s or s.startswith("-")
    hit = re.search(r"[\d,]*\.?\d+", s.replace(",", "").replace("(-)", ""))
    if not hit:
        return None
    try:
        v = float(hit.group(0))
    except ValueError:
        return None
    return -v if neg else v


def load_entries(path):
    """ledger -> summed signed movement over the window."""
    moves = defaultdict(float)
    rows = 0
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            led = (r.get("ledger") or "").strip()
            if not led:
                continue
            v = num(r.get("amount"))
            if v is None:
                v = num(r.get("amount_raw"))
            if v is None:
                continue
            moves[led] += v
            rows += 1
    return moves, rows


def load_balances(path):
    """ledger -> (opening, closing) as credit_export.py wrote them."""
    bal = {}
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            led = (r.get("Ledger Name") or "").strip()
            if not led:
                continue
            o, c = num(r.get("Opening (number)")), num(r.get("Closing (number)"))
            if o is None or c is None:
                continue
            bal[led] = (o, c)
    return bal


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: python reconcile.py <ledger_entries.csv> <credit_balances.csv>")
    moves, n_rows = load_entries(sys.argv[1])
    bal = load_balances(sys.argv[2])

    print(f"entries : {n_rows:,} rows over {len(moves):,} ledgers")
    print(f"balances: {len(bal):,} ledgers\n")

    common = sorted(set(moves) & set(bal))
    if not common:
        sys.exit("No ledger names in common. The two exports name ledgers differently —\n"
                 "compare a few rows by hand before trusting either file.")

    ok = flipped = off = 0
    worst = []
    for led in common:
        expected = bal[led][1] - bal[led][0]        # closing - opening
        actual = moves[led]
        diff = actual - expected
        if abs(diff) <= TOLERANCE:
            ok += 1
        elif abs(actual + expected) <= TOLERANCE and abs(expected) > TOLERANCE:
            flipped += 1                            # equal and opposite
        else:
            off += 1
            worst.append((abs(diff), led, expected, actual))

    print(f"ledgers compared      : {len(common):,}")
    print(f"  reconciled          : {ok:,}  ({ok/len(common)*100:.1f}%)")
    print(f"  EXACTLY INVERTED    : {flipped:,}   <- sign convention is backwards")
    print(f"  genuinely different : {off:,}")

    if flipped > ok and flipped:
        print("\nVERDICT: the sign convention is BACKWARDS. Movements match in size but")
        print("         not direction. Flip it in ledger_statement_export.to_number().")
    elif ok and ok >= len(common) * 0.95 and not flipped:
        print("\nVERDICT: reconciled. Direction, magnitude, completeness and window")
        print("         alignment are all confirmed against an independent export.")
    else:
        print("\nVERDICT: inconclusive — investigate the biggest gaps below first.")

    if worst:
        worst.sort(reverse=True)
        print(f"\nBiggest {min(15, len(worst))} discrepancies:\n")
        print(f"  {'ledger':44} {'expected':>14} {'from entries':>14} {'diff':>13}")
        for d, led, e, a in worst[:15]:
            print(f"  {led[:42]:44} {e:>14,.2f} {a:>14,.2f} {a-e:>13,.2f}")

    only_e = set(moves) - set(bal)
    only_b = {k for k in set(bal) - set(moves) if abs(bal[k][1] - bal[k][0]) > TOLERANCE}
    if only_e:
        print(f"\n{len(only_e)} ledger(s) had movement but no balance row "
              f"(expected: balances cover shops only, entries cover every ledger).")
    if only_b:
        print(f"{len(only_b)} shop(s) MOVED in the balances file but have no entries — "
              "investigate, this direction should not happen.")
        for k in sorted(only_b)[:8]:
            print(f"    {k[:50]:52} moved {bal[k][1]-bal[k][0]:,.2f}")


if __name__ == "__main__":
    main()
