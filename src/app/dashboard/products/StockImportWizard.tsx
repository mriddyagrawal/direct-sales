"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
// Reuse the Import wizard's grammar (scrim/panel/steps/table) — same shell, a
// stock-only body. Stock is global (no brand picker) and never money.
import styles from "./ImportWizard.module.css";

type Step = "upload" | "preview" | "applying" | "result" | "unreadable";
type RowStatus = "matched" | "notfound";

interface ParsedRow {
  rowNo: number; // spreadsheet row number, for the user to find it
  tallyName: string;
  currentQty: number | null; // matched product's current stock (for old→new)
  newQty: number; // parsed integer
  status: RowStatus;
}

interface Parsed {
  rows: ParsedRow[];
  skipped: number; // rows dropped for a blank name or a non-integer stock cell
}

interface StockImportWizardProps {
  onClose: () => void;
  onDone: () => void;
}

// Header aliases the operator's file might use (case-insensitive, trimmed).
const TALLY_HEADERS = ["tally name", "tally_name", "name", "item"];
const STOCK_HEADERS = ["stock", "stock_qty", "qty", "quantity", "closing", "closing balance"];

// Parse a stock cell to a strict integer (commas stripped). Returns null for a
// blank or non-integer value — mirrors the import_stock RPC's `^-?[0-9]+$` skip,
// so the preview shows exactly what the server will (and won't) apply.
function parseStock(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

// T3 — "Update stock" import. Model on ImportWizard, but: NO brand picker (stock
// matches globally on tally_name), accepts .csv AND .xlsx, and touches ONLY
// stock_qty/stock_updated_at (never price/name/category/active — the RPC
// enforces that). Admin-only: the button that opens it is admin-gated and
// import_stock re-checks the role server-side.
export function StockImportWizard({ onClose, onDone }: StockImportWizardProps) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [result, setResult] = useState<{ matched: number; notFound: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Tally Name", "Stock"],
      ["ECO WATT NEO 2300", 12],
      ["EVO D 2300", 0],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    XLSX.writeFile(wb, "stock-template.xlsx");
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" }); // parses .csv and .xlsx alike
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return setStep("unreadable");

      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][];
      if (grid.length < 1) return setStep("unreadable");

      const headers = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
      const iTally = headers.findIndex((h) => TALLY_HEADERS.includes(h));
      const iStock = headers.findIndex((h) => STOCK_HEADERS.includes(h));
      if (iTally === -1 || iStock === -1) return setStep("unreadable");

      // Diff against ALL products (global — stock isn't brand-scoped), fetched
      // fresh, keyed on lower(trim(tally_name)) to mirror the RPC's match.
      const supabase = createClient();
      const { data: existing } = await supabase.from("products").select("id, tally_name, name, stock_qty");
      const byTally = new Map(
        (existing ?? []).map((e) => [e.tally_name.trim().toLowerCase(), e] as const),
      );

      const rows: ParsedRow[] = [];
      let skipped = 0;
      for (let r = 1; r < grid.length; r++) {
        const cells = grid[r] ?? [];
        const tallyName = String(cells[iTally] ?? "").trim();
        const stockRaw = String(cells[iStock] ?? "").trim();
        if (!tallyName && !stockRaw) continue; // blank row

        const newQty = parseStock(stockRaw);
        if (!tallyName || newQty === null) {
          skipped++; // blank name or non-integer stock — mirrors the RPC skip
          continue;
        }
        const ex = byTally.get(tallyName.toLowerCase());
        rows.push({
          rowNo: r + 1,
          tallyName,
          currentQty: ex ? ex.stock_qty : null,
          newQty,
          status: ex ? "matched" : "notfound",
        });
      }

      setParsed({ rows, skipped });
      setStep("preview");
    } catch {
      setStep("unreadable");
    }
  }

  async function apply() {
    if (!parsed) return;
    setStep("applying");
    setError(null);
    // Send every valid row; the RPC updates matches and reports the rest as
    // unmatched (authoritative, in case the catalog moved since the preview).
    const p_rows = parsed.rows.map((r) => ({ tally_name: r.tallyName, stock_qty: r.newQty }));

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("import_stock", { p_rows });
    if (rpcError) {
      setError(rpcError.message);
      setStep("preview");
      return;
    }
    const res = (data ?? { matched: 0, unmatched: [] }) as { matched: number; unmatched: string[] };
    setResult({ matched: res.matched, notFound: res.unmatched ?? [] });
    setStep("result");
  }

  const counts = parsed
    ? {
        matched: parsed.rows.filter((r) => r.status === "matched").length,
        notfound: parsed.rows.filter((r) => r.status === "notfound").length,
      }
    : { matched: 0, notfound: 0 };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Update stock</h2>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className={styles.errorStrip}>{error}</p>}

        {step === "upload" && (
          <div className={styles.body}>
            <div
              className={`${styles.drop} ${dragOver ? styles.dropOver : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
            >
              Drag the stock file here, or click to choose
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className={styles.hiddenInput}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>

            <p className={styles.hint}>
              Two columns: <strong>Tally Name · Stock</strong> (from the Tally export tool). Matches products by their{" "}
              <strong>Tally name</strong> and updates only the stock count — never the price, name, or category. Names that
              don&apos;t match a product are reported, not created.
            </p>
            <button type="button" className={styles.linkBtn} onClick={downloadTemplate}>
              Download template
            </button>
          </div>
        )}

        {step === "preview" && parsed && (
          <div className={styles.body}>
            <div className={styles.summary}>
              <span className={styles.summaryItem}>
                <span className={`${styles.sq} ${styles.sqUpdated}`} /> Matched · {counts.matched}
              </span>
              <span className={styles.summaryItem}>
                <span className={`${styles.sq} ${styles.sqError}`} /> Not found · {counts.notfound}
              </span>
            </div>

            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.numeric}>ROW</th>
                    <th>TALLY NAME</th>
                    <th>STATUS</th>
                    <th className={styles.numeric}>CURRENT</th>
                    <th className={styles.numeric}>NEW</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row) => (
                    <tr key={row.rowNo} className={row.status === "notfound" ? styles.errorRow : ""}>
                      <td className={`${styles.mono} ${styles.numeric}`}>{row.rowNo}</td>
                      <td className={styles.mono}>{row.tallyName}</td>
                      <td>
                        {row.status === "matched" ? (
                          <span className={styles.statusTag}>Matched</span>
                        ) : (
                          <span className={styles.reason}>Not found — skipped</span>
                        )}
                      </td>
                      <td className={`${styles.mono} ${styles.numeric}`}>
                        {row.status === "notfound" ? "—" : row.currentQty === null ? "—" : row.currentQty}
                      </td>
                      <td className={`${styles.mono} ${styles.numeric}`}>{row.newQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {counts.notfound > 0 && (
              <p className={styles.hint}>
                {counts.notfound} Tally name{counts.notfound === 1 ? "" : "s"} didn&apos;t match any product — those are
                skipped. Fix the product&apos;s Tally name in the catalog, then re-upload.
              </p>
            )}
            {parsed.skipped > 0 && (
              <p className={styles.hint}>
                {parsed.skipped} row{parsed.skipped === 1 ? "" : "s"} skipped (blank name or a non-whole-number stock).
              </p>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Back
              </Button>
              <div className={styles.applyGroup}>
                {counts.notfound > 0 && <span className={styles.skipNote}>{counts.notfound} not-found rows will be skipped</span>}
                <Button variant="primary" onClick={apply} disabled={counts.matched === 0}>
                  Update {counts.matched} product{counts.matched === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "applying" && (
          <div className={styles.body}>
            <p className={styles.applying}>Updating stock… don&apos;t close this window.</p>
          </div>
        )}

        {step === "result" && result && (
          <div className={styles.body}>
            <div className={styles.resultGrid}>
              <div className={styles.resultStat}>
                <span className={styles.resultNum}>{result.matched}</span>
                <span className={styles.resultLabel}>Updated</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.resultNum}>{result.notFound.length}</span>
                <span className={styles.resultLabel}>Not found</span>
              </div>
            </div>
            {result.notFound.length > 0 && (
              <p className={styles.hint}>
                <strong>Not found</strong> (fix the Tally name in the catalog): {result.notFound.join(", ")}
              </p>
            )}
            <div className={styles.actions}>
              <Button variant="primary" onClick={onDone}>
                Done
              </Button>
            </div>
          </div>
        )}

        {step === "unreadable" && (
          <div className={styles.body}>
            <p className={styles.errorStrip}>
              Couldn&apos;t read this file — it needs a <strong>Tally Name</strong> column and a <strong>Stock</strong> column.
            </p>
            <button type="button" className={styles.linkBtn} onClick={downloadTemplate}>
              Download template
            </button>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Try another file
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
