"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { Button } from "@/components/ui/Button";
import { parsePricePaise } from "@/lib/price";
import { normalizeCategory, effectiveTallyName } from "@/lib/catalog";
import type { ProductRow } from "./page";
import styles from "./ProductModal.module.css";

export interface BrandOption {
  id: string;
  name: string;
}

interface ProductModalProps {
  mode: "add" | "edit";
  isAdmin: boolean;
  brands: BrandOption[];
  categoriesByBrand: Record<string, string[]>;
  initial?: ProductRow;
  onClose: () => void;
  onSaved: () => void;
}

// M5.5 commit 3 — one shared Add/Edit product form. Centered on desktop,
// bottom-sheet on phone (CSS). Add is admin-only (upsert on
// (brand_id, tally_name)); Edit (row-click) UPDATEs by id — accountant edits
// price/tally/active only, admin edits everything. Money via parsePricePaise
// (≤2 decimals → paise); blank tally folds to the display name; category is a
// brand-scoped typeahead that normalizes "speakers" → "Speakers" on save.
export function ProductModal({
  mode,
  isAdmin,
  brands,
  categoriesByBrand,
  initial,
  onClose,
  onSaved,
}: ProductModalProps) {
  const [brandId, setBrandId] = useState(initial?.brand_id ?? (brands.length === 1 ? brands[0].id : ""));
  const [category, setCategory] = useState(initial?.category ?? "");
  const [displayName, setDisplayName] = useState(initial?.name ?? "");
  const [tallyName, setTallyName] = useState(initial?.tally_name ?? "");
  const [price, setPrice] = useState(initial?.price_paise != null ? String(initial.price_paise / 100) : "");
  const [active, setActive] = useState(initial?.active ?? true);

  const [catOpen, setCatOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ category?: string; displayName?: string; price?: string }>({});
  const catBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Name + category are read-only for the accountant on Edit (they can retag
  // price/tally/active but not rename/recategorize); admin edits everything.
  // On Add, everyone here is admin (the button is admin-only).
  const nameLocked = mode === "edit" && !isAdmin;
  const brandLocked = mode === "edit"; // a product never moves brand via edit

  const brandCats = brandId ? (categoriesByBrand[brandId] ?? []) : [];
  const catTrim = category.trim();
  const catMatches = brandCats.filter((c) => c.toLowerCase().includes(catTrim.toLowerCase()));
  const exactExists = brandCats.some((c) => c.toLowerCase() === catTrim.toLowerCase());

  async function save() {
    const errs: typeof fieldErrors = {};
    if (!brandId) setError("Pick a brand.");
    if (!displayName.trim()) errs.displayName = "Display name is required.";
    if (!catTrim) errs.category = "Category is required.";

    const parsed = parsePricePaise(price);
    if (!parsed.ok) errs.price = parsed.error;

    if (!brandId || Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setError(null);
    setSaving(true);

    const pricePaise = parsed.ok ? parsed.paise : null;
    const normalizedCategory = normalizeCategory(category, brandCats);
    const tally = effectiveTallyName(tallyName, displayName);
    const supabase = createClient();

    let dbError;
    if (mode === "add") {
      // Upsert on the catalog key — a dup (brand_id, tally_name) updates the
      // existing row instead of duplicating (owner decision).
      ({ error: dbError } = await supabase
        .from("products")
        .upsert(
          {
            brand_id: brandId,
            category: normalizedCategory,
            name: displayName.trim(),
            tally_name: tally,
            price_paise: pricePaise,
            active,
          },
          { onConflict: "brand_id,tally_name" },
        ));
    } else {
      // Edit = UPDATE by id. Accountant may not touch name/category.
      const payload = nameLocked
        ? { tally_name: tally, price_paise: pricePaise, active }
        : { category: normalizedCategory, name: displayName.trim(), tally_name: tally, price_paise: pricePaise, active };
      ({ error: dbError } = await supabase.from("products").update(payload).eq("id", initial!.id));
    }

    if (dbError) {
      setSaving(false);
      setError(dbError.message);
      return;
    }
    onSaved();
  }

  // Admin-only hard delete, guarded server-side (delete_product): a product
  // that's ever been ordered is refused with a message pointing to deactivate.
  async function handleDelete() {
    if (!initial) return;
    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("delete_product", { p_id: initial.id });
    if (rpcError) {
      setDeleting(false);
      setConfirmDelete(false);
      setError(rpcError.message);
      return;
    }
    onSaved();
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>{mode === "add" ? "Add product" : "Edit product"}</h2>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close">
            <Glyph icon={X} />
          </button>
        </div>

        {error && <p className={styles.errorStrip}>{error}</p>}

        <div className={styles.body}>
          <div className={styles.selectField}>
            <label className={styles.label} htmlFor="pm-brand">
              Brand
            </label>
            <select
              id="pm-brand"
              className={styles.select}
              value={brandId}
              disabled={brandLocked}
              onChange={(e) => {
                setBrandId(e.target.value);
                setCategory(""); // categories are brand-scoped — reset on brand change
              }}
            >
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

          {/* Category = brand-scoped typeahead, disabled until a brand is chosen */}
          <div className={styles.comboWrap}>
            <Field
              label="Category"
              value={category}
              disabled={!brandId || nameLocked}
              placeholder={brandId ? "Type to filter or add new…" : "Pick a brand first"}
              error={fieldErrors.category}
              onChange={(e) => {
                setCategory(e.target.value);
                setCatOpen(true);
              }}
              onFocus={() => setCatOpen(true)}
              onBlur={() => {
                catBlurTimer.current = setTimeout(() => setCatOpen(false), 120);
              }}
            />
            {catOpen && brandId && !nameLocked && (catMatches.length > 0 || (catTrim && !exactExists)) && (
              <div className={styles.combo}>
                {catMatches.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={styles.comboOption}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCategory(c);
                      setCatOpen(false);
                    }}
                  >
                    {c}
                  </button>
                ))}
                {catTrim && !exactExists && (
                  <button
                    type="button"
                    className={`${styles.comboOption} ${styles.comboNew}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCatOpen(false);
                    }}
                  >
                    + NEW: {catTrim}
                  </button>
                )}
              </div>
            )}
          </div>

          <Field
            label="Display name"
            value={displayName}
            disabled={nameLocked}
            error={fieldErrors.displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <Field
            label="Tally name"
            value={tallyName}
            placeholder={displayName.trim() || "Blank ⇒ uses the display name"}
            onChange={(e) => setTallyName(e.target.value)}
          />

          <Field
            label="Price (₹)"
            value={price}
            inputMode="decimal"
            placeholder="Blank = TBD"
            error={fieldErrors.price}
            onChange={(e) => setPrice(e.target.value)}
          />

          <button type="button" className={styles.toggle} onClick={() => setActive((a) => !a)}>
            {active ? "Active — click to deactivate" : "Inactive — click to activate"}
          </button>
        </div>

        <div className={styles.actions}>
          {/* Hard delete — admin-only, edit mode only. Two-step (Delete →
              Confirm delete) so a bright-red button next to Cancel can't be a
              one-tap accident. Server-guarded: an ordered product is refused. */}
          {mode === "edit" &&
            isAdmin &&
            initial &&
            (confirmDelete ? (
              <Button variant="destructive-filled" onClick={handleDelete} loading={deleting}>
                Confirm delete
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {mode === "add" ? "Add product" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
