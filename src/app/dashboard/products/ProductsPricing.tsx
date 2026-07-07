"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { formatRupees } from "@/lib/format";
import type { ProductRow } from "./page";
import styles from "./ProductsPricing.module.css";

interface EditForm {
  priceRupees: string;
  tallyName: string;
  active: boolean;
}

// Owner-added — pricing lives in-app now, not Supabase Studio. Setting a
// price on a TBD SKU makes it salesman-visible immediately (D2) — no
// deploy, since products_select_salesman is a plain RLS predicate.
//
// review flag ㉜(🅐): products must render straight from the `initialProducts`
// prop, never copied into useState — a plain useState reads its initializer
// once, so a post-save router.refresh() would deliver fresh server data the
// component then ignores, leaving the row showing the stale pre-save value.
export function ProductsPricing({ initialProducts: products }: { initialProducts: ProductRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({ priceRupees: "", tallyName: "", active: true });
  const [saving, setSaving] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const groups: { category: string; products: ProductRow[] }[] = [];
  for (const p of products) {
    const last = groups[groups.length - 1];
    if (last && last.category === p.category) last.products.push(p);
    else groups.push({ category: p.category, products: [p] });
  }

  function startEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({
      priceRupees: p.price_paise === null ? "" : String(Math.round(p.price_paise / 100)),
      tallyName: p.tally_name ?? "",
      active: p.active,
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function save(id: string) {
    const trimmed = form.priceRupees.trim();
    let pricePaise: number | null = null;
    if (trimmed !== "") {
      if (!/^\d+$/.test(trimmed)) {
        setError("Price must be a whole, non-negative number of rupees.");
        return;
      }
      pricePaise = Number(trimmed) * 100;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("products")
      .update({
        // tally_name is NOT NULL (M5.5) and is the catalog key — blank folds
        // to the display name rather than clearing it (matches the Add/Edit
        // modal's rule; commit 3 replaces this inline card with that modal).
        price_paise: pricePaise,
        tally_name: form.tallyName.trim() || products.find((x) => x.id === id)?.name,
        active: form.active,
      })
      .eq("id", id);
    if (updateError) {
      setSaving(false);
      setError(updateError.message);
      return;
    }
    setEditingId(null);
    setSaving(false);
    // Stay busy through the refresh (review flag ㉜(🅑)) — router.refresh()
    // repaints asynchronously; isPending keeps the button spinning until the
    // new data actually lands instead of going idle the instant the write
    // resolves.
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>Products</h1>
        <span className={styles.count}>{products.length} SKUs</span>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {groups.map((group) => (
        <section key={group.category}>
          <p className={styles.categoryHeader}>
            {group.category} · {group.products.length}
          </p>
          {group.products.map((p) => {
            if (editingId === p.id) {
              return (
                <div key={p.id} className={styles.editCard}>
                  <div className={styles.editRow}>
                    <Field
                      label="Price (₹, whole rupees)"
                      value={form.priceRupees}
                      onChange={(e) => setForm({ ...form, priceRupees: e.target.value })}
                      placeholder="e.g. 523 (blank = TBD)"
                      inputMode="numeric"
                    />
                    <Field
                      label="Tally name"
                      value={form.tallyName}
                      onChange={(e) => setForm({ ...form, tallyName: e.target.value })}
                      placeholder={p.name}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.toggleButton}
                    onClick={() => setForm({ ...form, active: !form.active })}
                  >
                    {form.active ? "Active — click to deactivate" : "Inactive — click to activate"}
                  </button>
                  <div className={styles.editActions}>
                    <Button variant="secondary" onClick={cancelEdit}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={() => save(p.id)} loading={saving || isPending}>
                      Save
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div key={p.id} className={`${styles.row} ${!p.active ? styles.rowInactive : ""}`}>
                <div className={styles.rowInfo}>
                  <p className={styles.rowName}>
                    {p.name}
                    {p.price_paise === null && <span className={styles.tbdBadge}>TBD</span>}
                    {!p.active && <span className={styles.inactiveBadge}>INACTIVE</span>}
                  </p>
                  <p className={styles.rowMeta}>{p.tally_name}</p>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.price} onClick={() => startEdit(p)}>
                    {p.price_paise === null ? "Set price" : formatRupees(p.price_paise)}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
