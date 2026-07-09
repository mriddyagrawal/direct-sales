// LG serial extraction — shared by the godown scanner (live display) and
// mirrored server-side in submit_pick (authoritative; the client's extraction
// is never trusted for storage).
//
// Raw scan = [4-char prefix][13-char serial]"IN", e.g. W5LN·606NWFG207155·IN.
// The 13-char serial (3 digits mfg year+month · 4 letters line code · 6-digit
// sequence) is exactly what Tally stores. Validated across 8 serials / 5
// categories (docs/godown-fulfilment-design.md). The prefix and "IN" suffix
// contain no 3-digit run, so the regex can't false-match on them — it holds
// even if the prefix length ever changes.
const SERIAL_RE = /\d{3}[A-Z]{4}\d{6}/;

export function extractSerial(raw: string): { serial: string; parsed: boolean } {
  const m = raw.match(SERIAL_RE);
  return m ? { serial: m[0], parsed: true } : { serial: raw.trim(), parsed: false };
}
