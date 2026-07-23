"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { formatRupees } from "@/lib/format";
import { parsePricePaise } from "@/lib/price";
import { normalizeCategory, effectiveTallyName } from "@/lib/catalog";
import type { BrandOption } from "./ProductModal";
import styles from "./ImportWizard.module.css";

type Step = "upload" | "preview" | "applying" | "result" | "unreadable";
type RowStatus = "new" | "updated" | "error";

interface ParsedRow {
  rowNo: number; // the actual spreadsheet row number, for the user to find it
  category: string; // normalized (for valid rows) / raw (for error rows)
  name: string;
  tallyName: string; // effective (blank folded to display name)
  pricePaise: number | null;
  active: boolean;
  status: RowStatus;
  reason?: string;
}

interface Parsed {
  rows: ParsedRow[];
  untouched: number; // brand products absent from the file (never touched)
}

interface ImportWizardProps {
  brands: BrandOption[];
  onClose: () => void;
  onDone: () => void;
}

function parseActive(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (t === "") return true;
  return !["false", "no", "0", "inactive", "n"].includes(t);
}

// M5.5 commit 4 — Excel import wizard (Upload → Preview → Result). Admin-only
// (the button that opens it is admin-gated, and import_products re-checks the
// role server-side). One brand per file. Parse + diff runs client-side against
// the brand's current catalog keyed on (brand_id, effective tally_name); Apply
// upserts the valid rows atomically via the import_products RPC — idempotent
// (re-run = all Updated) and never deletes (untouched rows are only reported).
export function ImportWizard({ brands, onClose, onDone }: ImportWizardProps) {
  const [step, setStep] = useState<Step>("upload");
  const [brandId, setBrandId] = useState(brands.length === 1 ? brands[0].id : "");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const brandName = brands.find((b) => b.id === brandId)?.name ?? "products";

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Category", "Display Name", "Tally Name", "Price", "Active"],
      ["Speakers", "Example Speaker X1", "ZEB-SPK-X1", 557.5, "TRUE"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, `${brandName.toLowerCase().replace(/\s+/g, "-")}-import-template.xlsx`);
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return setStep("unreadable");

      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][];
      if (grid.length < 1) return setStep("unreadable");

      const headers = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
      const iCat = headers.indexOf("category");
      const iName = headers.indexOf("display name");
      const iTally = headers.indexOf("tally name");
      const iPrice = headers.indexOf("price");
      const iActive = headers.indexOf("active");
      // Category is required; the "name" can come from EITHER a Display Name or
      // a Tally Name column (whichever is present fills the other). So the sheet
      // is recognisable with Category + at least one of the two name columns.
      if (iCat === -1 || (iName === -1 && iTally === -1)) return setStep("unreadable");

      // Diff against the brand's *current* catalog (fetched fresh, not the
      // page's initial snapshot), keyed on (brand_id, tally_name).
      const supabase = createClient();
      const { data: existing } = await supabase
        .from("products")
        .select("category, tally_name, name, price_paise, active")
        .eq("brand_id", brandId);
      const brandCats = Array.from(new Set((existing ?? []).map((e) => e.category)));
      // Keyed by tally_name (the match key) so a blank cell on a matched row can
      // fall back to the product's CURRENT value — a partial-patch import where a
      // blank means "leave it alone", not "overwrite with a blank/fallback".
      const existingByTally = new Map((existing ?? []).map((e) => [e.tally_name, e] as const));

      const rows: ParsedRow[] = [];
      const fileTallies = new Set<string>();
      for (let r = 1; r < grid.length; r++) {
        const cells = grid[r] ?? [];
        const cell = (i: number) => (i === -1 ? "" : String(cells[i] ?? "").trim());
        const cat = cell(iCat);
        const rawName = cell(iName);
        const rawTally = cell(iTally);
        const priceCell = cell(iPrice);
        const activeCell = cell(iActive);
        if (!cat && !rawName && !rawTally && !priceCell && !activeCell) continue; // blank row

        const rowNo = r + 1; // 1-based, header is row 1
        const effTally = effectiveTallyName(rawTally, rawName); // match key: tally ← display
        const ex = existingByTally.get(effTally);
        const matched = ex !== undefined;
        fileTallies.add(effTally);

        const parsedPrice = parsePricePaise(priceCell); // blank ⇒ ok, paise null
        let reason: string | undefined;
        if (!rawName && !rawTally) reason = "Display name or Tally name is required";
        else if (!cat && !matched) reason = "Category is required"; // a NEW product needs one; a match keeps its own
        else if (!parsedPrice.ok) reason = parsedPrice.error;

        if (reason) {
          rows.push({ rowNo, category: cat, name: rawName || rawTally, tallyName: effTally, pricePaise: null, active: true, status: "error", reason });
          continue;
        }

        // Partial-patch resolve. A blank cell KEEPS the matched product's current
        // value; a NEW product falls back (name ← tally, price → TBD, active →
        // true). The RPC still overwrites, but for a match we hand it the current
        // value, so a blank changes nothing.
        const category = cat ? normalizeCategory(cat, brandCats) : ex!.category;
        const name = rawName || (matched ? ex!.name : rawTally);
        const providedPaise = parsedPrice.ok ? parsedPrice.paise : null; // .ok guaranteed — error rows already continued
        const pricePaise = priceCell !== "" ? providedPaise : matched ? ex!.price_paise : null;
        const active = activeCell !== "" ? parseActive(activeCell) : matched ? ex!.active : true;

        rows.push({
          rowNo,
          category,
          name,
          tallyName: effTally,
          pricePaise,
          active,
          status: matched ? "updated" : "new",
        });
      }

      const untouched = (existing ?? []).filter((e) => !fileTallies.has(e.tally_name)).length;
      setParsed({ rows, untouched });
      setStep("preview");
    } catch {
      setStep("unreadable");
    }
  }

  async function apply() {
    if (!parsed) return;
    setStep("applying");
    setError(null);
    const valid = parsed.rows
      .filter((r) => r.status !== "error")
      .map((r) => ({ category: r.category, name: r.name, tally_name: r.tallyName, price_paise: r.pricePaise, active: r.active }));

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("import_products", { p_brand_id: brandId, p_rows: valid });
    if (rpcError) {
      setError(rpcError.message);
      setStep("preview");
      return;
    }
    const res = (data ?? { added: 0, updated: 0 }) as { added: number; updated: number };
    setResult({ added: res.added, updated: res.updated, skipped: parsed.rows.filter((r) => r.status === "error").length });
    setStep("result");
  }

  const counts = parsed
    ? {
        new: parsed.rows.filter((r) => r.status === "new").length,
        updated: parsed.rows.filter((r) => r.status === "updated").length,
        errors: parsed.rows.filter((r) => r.status === "error").length,
      }
    : { new: 0, updated: 0, errors: 0 };
  const validCount = counts.new + counts.updated;

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Import products</h2>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className={styles.errorStrip}>{error}</p>}

        {step === "upload" && (
          <div className={styles.body}>
            <div className={styles.selectField}>
              <label className={styles.label} htmlFor="iw-brand">
                Brand · one per file
              </label>
              <select id="iw-brand" className={styles.select} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="" disabled>
                  Choose a brand…
                </option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              className={`${styles.drop} ${dragOver ? styles.dropOver : ""} ${!brandId ? styles.dropDisabled : ""}`}
              onClick={() => brandId && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (brandId) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (brandId && f) void handleFile(f);
              }}
            >
              {brandId ? "Drag an .xlsx here, or click to choose" : "Pick a brand first"}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className={styles.hiddenInput}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>

            <p className={styles.hint}>
              Expected columns: <strong>Category · Display Name · Tally Name · Price · Active</strong>. Give a{" "}
              <strong>Display Name or Tally Name</strong>; a new product also needs a Category. On an existing product any blank cell
              keeps its current value; a new product uses the Tally name for a blank Display name and TBD for a blank Price.
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
                <span className={`${styles.sq} ${styles.sqNew}`} /> New · {counts.new}
              </span>
              <span className={styles.summaryItem}>
                <span className={`${styles.sq} ${styles.sqUpdated}`} /> Updated · {counts.updated}
              </span>
              <span className={styles.summaryItem}>
                <span className={`${styles.sq} ${styles.sqError}`} /> Errors · {counts.errors}
              </span>
            </div>

            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.numeric}>ROW</th>
                    <th>STATUS</th>
                    <th>CATEGORY</th>
                    <th>DISPLAY NAME</th>
                    <th>TALLY NAME</th>
                    <th className={styles.numeric}>PRICE</th>
                    <th>ACTIVE</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row) => (
                    <tr key={row.rowNo} className={row.status === "error" ? styles.errorRow : ""}>
                      <td className={`${styles.mono} ${styles.numeric}`}>{row.rowNo}</td>
                      <td>
                        {row.status === "error" ? (
                          <span className={styles.reason}>{row.reason}</span>
                        ) : (
                          <span className={styles.statusTag}>{row.status === "new" ? "New" : "Updated"}</span>
                        )}
                      </td>
                      <td>{row.category || "—"}</td>
                      <td className={styles.cellName}>{row.name || "—"}</td>
                      <td className={styles.mono}>{row.tallyName || "—"}</td>
                      <td className={`${styles.mono} ${styles.numeric}`}>
                        {row.status === "error" ? "—" : row.pricePaise === null ? "TBD" : formatRupees(row.pricePaise)}
                      </td>
                      <td>{row.status === "error" ? "—" : row.active ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {counts.updated > 0 && (
              <p className={styles.hint}>
                <strong>Updated</strong> rows show the value each product will have — a blank cell in your file keeps the product&apos;s
                current value, so only what you filled in changes.
              </p>
            )}

            {parsed.untouched > 0 && (
              <p className={styles.hint}>
                {parsed.untouched} product{parsed.untouched === 1 ? "" : "s"} already in the catalog aren&apos;t in this file —
                left untouched (deactivate discontinued ones manually).
              </p>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Back
              </Button>
              <div className={styles.applyGroup}>
                {counts.errors > 0 && <span className={styles.skipNote}>{counts.errors} error rows will be skipped</span>}
                <Button variant="primary" onClick={apply} disabled={validCount === 0}>
                  {counts.errors > 0 ? `Apply ${validCount} valid rows` : `Apply import · ${validCount} rows`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === "applying" && (
          <div className={styles.body}>
            <p className={styles.applying}>Applying… don&apos;t close this window.</p>
          </div>
        )}

        {step === "result" && result && (
          <div className={styles.body}>
            <div className={styles.resultGrid}>
              <div className={styles.resultStat}>
                <span className={styles.resultNum}>{result.added}</span>
                <span className={styles.resultLabel}>Added</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.resultNum}>{result.updated}</span>
                <span className={styles.resultLabel}>Updated</span>
              </div>
              <div className={styles.resultStat}>
                <span className={styles.resultNum}>{result.skipped}</span>
                <span className={styles.resultLabel}>Skipped</span>
              </div>
            </div>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onDone}>
                Done
              </Button>
            </div>
          </div>
        )}

        {step === "unreadable" && (
          <div className={styles.body}>
            <p className={styles.errorStrip}>Couldn&apos;t read this file — not a valid .xlsx or the columns don&apos;t match.</p>
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
