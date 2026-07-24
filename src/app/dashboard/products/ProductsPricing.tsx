"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, PackagePlus, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAdminProducts } from "@/lib/queries/products";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { formatRupees, formatShortDate } from "@/lib/format";
import { groupProductsStockFirst, brandGroupCount } from "@/lib/product-grouping";
import { ProductModal, type BrandOption } from "./ProductModal";
import { ImportWizard } from "./ImportWizard";
import { StockImportWizard } from "./StockImportWizard";
import type { ProductRow } from "./page";
import styles from "./ProductsPricing.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; product: ProductRow } | null;

// M5.5 commit 2 — Products catalog ledger (S8 grammar: hairlines, mono
// figures, muted metadata, bold display name). Replaces the grouped
// price-edit card list.
//
// review flag ㉜🅐, cache edition: renders straight from the QUERY CACHE
// (["products", "admin"], seeded by the page's HydrationBoundary), never
// copied into useState — a post-write router.refresh() re-renders the page
// and its fresh dehydrated payload feeds this same cache (spec D2/D7), so the
// table shows fresh server data exactly as the prop version did.
//
// Editable surfaces: the inline ACTIVE toggle, plus the shared Add/Edit modal
// — "+ Add product" (admin-only) and row-click to edit any row (accountant
// edits price/tally/active; admin edits all fields).
export function ProductsPricing({ brands, isAdmin }: { brands: BrandOption[]; isAdmin: boolean }) {
  const router = useRouter();
  // Spec D10/D13: `?? []` keeps a painted ledger painted if a background
  // refetch fails; never gate rendering on isError.
  const { data: products = [] } = useQuery({
    queryKey: ["products", "admin"],
    queryFn: () => fetchAdminProducts(createClient()),
  });
  const queryClient = useQueryClient();
  // Optimistic active overlay so a row's toggle flips instantly instead of
  // waiting on router.refresh(). useOptimistic auto-reconciles to the server
  // prop once it updates (post-refresh, or after a modal edit changes active),
  // so a stale flip can never mask real data — preserving render-from-prop
  // (㉜🅐). Render from `displayProducts` where active matters.
  const [displayProducts, applyOptimisticActive] = useOptimistic(
    products,
    (state: ProductRow[], patch: { id: string; active: boolean }) =>
      state.map((p) => (p.id === patch.id ? { ...p, active: patch.active } : p)),
  );
  // review flag ㉜🅑: which rows are mid-write (a Set — several toggles can be
  // in flight at once, unlike a single id which behaved like a radio button).
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [importing, setImporting] = useState(false);
  const [stockImporting, setStockImporting] = useState(false);
  // The one Add entry point (owner 2026-07-24): "+ Add" button / phone FAB →
  // a chooser sheet (Add 1 product / Import), then the familiar second step.
  const [addChooser, setAddChooser] = useState(false);
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("all"); // "all" | brand_id
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "out" | "nosync">("all");
  // Phone sticky offsets — the salesman-page pattern: the search bar's live
  // height feeds --pm-search-h so brand/category headers pin right below it.
  const phoneRef = useRef<HTMLDivElement>(null);
  const phoneBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = phoneBarRef.current;
    const wrap = phoneRef.current;
    if (!bar || !wrap) return;
    const sync = () => wrap.style.setProperty("--pm-search-h", `${bar.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const priced = products.filter((p) => p.price_paise !== null).length;

  // Brand-filter options — brands actually present in the catalog, A→Z.
  const brandOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) if (!byId.has(p.brand_id)) byId.set(p.brand_id, p.brands?.name ?? "—");
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const q = query.trim().toLowerCase();
  const matchesQuery = (p: ProductRow) =>
    q === "" ||
    p.name.toLowerCase().includes(q) ||
    p.tally_name.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    (p.brands?.name ?? "").toLowerCase().includes(q);
  // Stock filter distinguishes confirmed-zero (=0) from never-synced (null) —
  // "Not synced" surfaces the catalog rows Tally has never touched.
  const matchesStock = (p: ProductRow) =>
    stockFilter === "all"
      ? true
      : stockFilter === "in"
        ? p.stock_qty != null && p.stock_qty > 0
        : stockFilter === "out"
          ? p.stock_qty === 0
          : p.stock_qty === null; // "nosync"
  const filteredProducts = displayProducts.filter(
    (p) => matchesQuery(p) && (brandFilter === "all" || p.brand_id === brandFilter) && matchesStock(p),
  );
  const filteredPriced = filteredProducts.filter((p) => p.price_paise !== null).length;
  const isFiltered = filteredProducts.length !== products.length;

  // Brand-scoped existing categories drive the modal's typeahead + the
  // "speakers"→"Speakers" normalization (derived from the full catalog).
  const categoriesByBrand = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of products) {
      const list = (map[p.brand_id] ??= []);
      if (!list.includes(p.category)) list.push(p.category);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.localeCompare(b));
    return map;
  }, [products]);

  // Phone grouping (owner 2026-07-24): the SAME stock-first Brand▸Category
  // structure as the salesman Products page, via the shared lib util — in-stock
  // categories first, then "(out of stock)", everything A→Z. Desktop keeps the
  // flat table. eslint disable mirrors `visible` in ProductsBrowse: the deps
  // that matter are the filtered list itself.
  const phoneGroups = useMemo(
    () => groupProductsStockFirst(filteredProducts.map((p) => ({ ...p, brand_name: p.brands?.name ?? "—" }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayProducts, q, brandFilter, stockFilter],
  );
  const multiBrandProducts = phoneGroups.length >= 2;

  // Latest sync across the catalog — one "Stock as of" line on the phone list
  // (the salesman-page pattern) instead of a per-card "as of" echo.
  const stockAsOf = useMemo(() => {
    let max: string | null = null;
    for (const p of products) if (p.stock_updated_at && (max === null || p.stock_updated_at > max)) max = p.stock_updated_at;
    return max;
  }, [products]);

  // D7 (spec): every product write refreshes BOTH product caches — the admin
  // ledger prefix (["products"]) and the Quick Order picker (["catalog"]) —
  // so a price/stock/active change reaches the salesman's screens without a
  // reload. router.refresh() stays alongside (it feeds the same cache via the
  // page's dehydrated payload).
  function invalidateProducts() {
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  }

  function closeAndRefresh() {
    setModal(null);
    invalidateProducts();
    router.refresh();
  }

  // Phone row (owner 2026-07-24) — the salesman Products row, plus the admin
  // layer: tap-to-edit, INACTIVE badge, and the null-stock distinction the
  // salesman page folds away (>0 green "N in stock" · 0 red "out of stock" ·
  // null muted "not synced"). Name follows the Quick Order standard —
  // "model・display" on show_model brands, plain name otherwise.
  function renderMobileRow(p: ProductRow) {
    const showModel = p.brands?.show_model ?? false;
    return (
      <div
        key={p.id}
        className={`${styles.mRow} ${styles.clickable} ${!p.active ? styles.mRowInactive : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setModal({ mode: "edit", product: p })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setModal({ mode: "edit", product: p });
          }
        }}
      >
        <p className={styles.mName}>
          {showModel && p.tally_name && p.tally_name !== p.name ? (
            <>
              <span className={styles.mModelPrefix}>{p.tally_name}</span>
              {"・"}
              {p.name}
            </>
          ) : (
            p.name
          )}
          {!p.active && <span className={styles.inactiveBadge}>INACTIVE</span>}
        </p>
        <div className={styles.mMeta}>
          <span className={styles.mono}>
            {p.price_paise === null ? <span className={styles.tbd}>—</span> : formatRupees(p.price_paise)}
          </span>
          {p.stock_qty === null ? (
            <span className={styles.mNotSynced}>not synced</span>
          ) : p.stock_qty > 0 ? (
            <span className={`${styles.mStockPill} ${styles.mStockIn}`}>{p.stock_qty} in stock</span>
          ) : (
            <span className={`${styles.mStockPill} ${styles.mStockOut}`}>out of stock</span>
          )}
        </div>
      </div>
    );
  }

  function toggleActive(p: ProductRow) {
    const next = !p.active; // p is from displayProducts, so this is the shown state
    setBusy((prev) => new Set(prev).add(p.id));
    setError(null);
    startTransition(async () => {
      applyOptimisticActive({ id: p.id, active: next }); // instant flip; auto-reverts if the write fails
      const supabase = createClient();
      const { error: updateError } = await supabase.from("products").update({ active: next }).eq("id", p.id);
      if (updateError) setError(updateError.message);
      else {
        invalidateProducts();
        router.refresh(); // reconciles the overlay to fresh server data
      }
      setBusy((prev) => {
        const s = new Set(prev);
        s.delete(p.id);
        return s;
      });
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Products</h1>
        <span className={styles.count}>
          {isFiltered
            ? `${filteredProducts.length} of ${products.length} products · ${filteredPriced} priced`
            : `${products.length} products · ${priced} priced`}
        </span>
        {isAdmin && (
          <div className={styles.titleActions}>
            {/* Update stock is DESKTOP-ONLY (owner 2026-07-24) — on phone the
                .bat auto-push covers it and the FAB sheet stays two options. */}
            <Button variant="secondary" onClick={() => setStockImporting(true)}>
              Update stock
            </Button>
            {/* One Add entry point: chooser → Add 1 product / Import. */}
            <Button variant="primary" onClick={() => setAddChooser(true)}>
              <Glyph icon={PackagePlus} />
              Add
            </Button>
          </div>
        )}
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Glyph icon={Search} size={14} />
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products — name, model, category or brand"
          />
        </div>
        <select
          className={styles.filterSelect}
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          aria-label="Filter by brand"
        >
          <option value="all">All brands</option>
          {brandOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as "all" | "in" | "out" | "nosync")}
          aria-label="Filter by stock"
        >
          <option value="all">All stock</option>
          <option value="in">In stock</option>
          <option value="out">Out of stock</option>
          <option value="nosync">Not synced</option>
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {products.length === 0 ? (
        <p className={styles.empty}>No products in the catalog.</p>
      ) : (
        <>
          {/* Desktop no-match note (the phone list carries its own, inside the
              sticky-bar block so the filters stay reachable). */}
          {filteredProducts.length === 0 && (
            <p className={`${styles.empty} ${styles.desktopOnly}`}>
              {q === "" ? "No products match the current filters." : `No products match "${query}".`}
            </p>
          )}
          {filteredProducts.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.numeric}>#</th>
                <th>BRAND</th>
                <th>CATEGORY</th>
                <th>DISPLAY NAME</th>
                <th>TALLY NAME</th>
                <th className={styles.numeric}>PRICE</th>
                <th className={styles.numeric}>STOCK</th>
                <th>ACTIVE</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p, index) => (
                <tr
                  key={p.id}
                  className={`${styles.clickable} ${!p.active ? styles.rowInactive : ""}`}
                  onClick={() => setModal({ mode: "edit", product: p })}
                >
                  <td className={`${styles.mono} ${styles.numeric} ${styles.cellMeta}`}>{index + 1}</td>
                  <td className={styles.cellMeta}>{p.brands?.name ?? "—"}</td>
                  <td className={styles.cellMeta}>{p.category}</td>
                  <td className={styles.cellName}>{p.name}</td>
                  <td className={`${styles.mono} ${styles.cellMeta}`}>{p.tally_name}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>
                    {p.price_paise === null ? <span className={styles.tbd}>—</span> : formatRupees(p.price_paise)}
                  </td>
                  <td
                    className={`${styles.mono} ${styles.numeric}`}
                    title={p.stock_updated_at ? `as of ${formatShortDate(p.stock_updated_at)}` : undefined}
                  >
                    {p.stock_qty === null ? <span className={styles.tbd}>—</span> : p.stock_qty}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`${styles.toggle} ${p.active ? styles.toggleOn : styles.toggleOff}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleActive(p);
                      }}
                      disabled={busy.has(p.id)}
                    >
                      {p.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}

          {/* Phone list (owner 2026-07-24): the salesman Products layout — a
              sticky search+filters bar the headers pin under, then stock-first
              Brand▸Category groups. Always rendered (even on no-match) so the
              filters stay reachable to clear. */}
          <div
            className={`${styles.phone} ${multiBrandProducts ? styles.phoneTwoTier : ""}`}
            ref={phoneRef}
          >
            {/* Sticky bar (owner 2026-07-24 v2): the two filters split the top
                line 50/50, the search takes its own full line below, "Stock as
                of" sits under the search. */}
            <div className={styles.pBar} ref={phoneBarRef}>
              <div className={styles.pFilterPair}>
                <select
                  className={styles.pSelect}
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  aria-label="Brand"
                >
                  <option value="all">All brands</option>
                  {brandOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.pSelect}
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as "all" | "in" | "out" | "nosync")}
                  aria-label="Stock"
                >
                  <option value="all">All stock</option>
                  <option value="in">In stock</option>
                  <option value="out">Out of stock</option>
                  <option value="nosync">Not synced</option>
                </select>
              </div>
              <div className={styles.pSearchBox}>
                <Glyph icon={Search} size={14} />
                <input
                  className={styles.pSearch}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, model, brand"
                />
              </div>
              {stockAsOf && <span className={styles.pAsOf}>Stock as of {formatShortDate(stockAsOf)}</span>}
            </div>

            {filteredProducts.length === 0 ? (
              <div className={styles.pEmpty}>
                <p>{q === "" ? "No products match the current filters." : `No products match "${query}".`}</p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setBrandFilter("all");
                    setStockFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              phoneGroups.map((bg) => (
                <section key={bg.brandId}>
                  {multiBrandProducts && (
                    <div className={styles.pBrandHeader}>
                      <span>{bg.brandName}</span>
                      <span className={styles.pHeaderCount}>{brandGroupCount(bg)} products</span>
                    </div>
                  )}
                  {bg.categories.map((c) => (
                    <section key={`${c.category}__${c.outOfStock ? "out" : "in"}`}>
                      <div className={styles.pCatHeader}>
                        <span>{c.outOfStock ? `${c.category} (out of stock)` : c.category}</span>
                        <span className={styles.pHeaderCount}>{c.products.length}</span>
                      </div>
                      {c.products.map(renderMobileRow)}
                    </section>
                  ))}
                </section>
              ))
            )}
          </div>
        </>
      )}

      {/* Phone FAB (admin): the one Add entry point → the chooser sheet. */}
      {isAdmin && (
        <button type="button" className={styles.pFab} onClick={() => setAddChooser(true)}>
          <Glyph icon={PackagePlus} />
          Add
        </button>
      )}

      {/* Add chooser — bottom sheet on phone, centered panel on desktop (the
          ProductModal responsive pattern, owner 2026-07-24). */}
      {addChooser && (
        <div className={styles.chooserScrim} onClick={() => setAddChooser(false)}>
          <div className={styles.chooserPanel} onClick={(e) => e.stopPropagation()}>
            {/* Same header grammar as ProductModal/ImportWizard: 21px token
                heading + the 16px ✕ (owner 2026-07-24 — the 3 popups match). */}
            <div className={styles.chooserHeader}>
              <h2 className={styles.chooserHeading}>Add products</h2>
              <button type="button" className={styles.chooserClose} onClick={() => setAddChooser(false)} aria-label="Close">
                <Glyph icon={X} />
              </button>
            </div>
            {/* Two EQUAL choices — option rows, not a primary CTA + secondary
                (a chooser has no "preferred" answer; the blue slab read wrong). */}
            <button
              type="button"
              className={styles.chooserOption}
              onClick={() => {
                setAddChooser(false);
                setModal({ mode: "add" });
              }}
            >
              <Glyph icon={PackagePlus} />
              <span className={styles.chooserOptionText}>
                <span className={styles.chooserOptionTitle}>New product</span>
                <span className={styles.chooserOptionHint}>Enter one product by hand</span>
              </span>
            </button>
            <button
              type="button"
              className={styles.chooserOption}
              onClick={() => {
                setAddChooser(false);
                setImporting(true);
              }}
            >
              <Glyph icon={FileSpreadsheet} />
              <span className={styles.chooserOptionText}>
                <span className={styles.chooserOptionTitle}>Import from Excel</span>
                <span className={styles.chooserOptionHint}>Paste rows — adds new, updates existing</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {modal && (
        <ProductModal
          mode={modal.mode}
          isAdmin={isAdmin}
          brands={brands}
          categoriesByBrand={categoriesByBrand}
          initial={modal.mode === "edit" ? modal.product : undefined}
          onClose={() => setModal(null)}
          onSaved={closeAndRefresh}
        />
      )}

      {importing && (
        <ImportWizard
          brands={brands}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            invalidateProducts();
            router.refresh();
          }}
        />
      )}

      {stockImporting && (
        <StockImportWizard
          onClose={() => setStockImporting(false)}
          onDone={() => {
            setStockImporting(false);
            invalidateProducts();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
