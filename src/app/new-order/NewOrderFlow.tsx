"use client";

import { useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { PickRetailer, type SelectedRetailer } from "./PickRetailer";
import { QuickOrder } from "./QuickOrder";
import { Review } from "./Review";
import { Confirmation } from "./Confirmation";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { formatRupees } from "@/lib/format";
import styles from "./NewOrderFlow.module.css";
import {
  type DraftCart,
  createDraft,
  loadDraft,
  saveDraft,
  clearDraft,
  cartTotalPaise,
  nowMs,
  getLastActiveRetailerId,
  setLastActiveRetailerId,
  clearLastActiveRetailerId,
} from "@/lib/cart";
import { submitOrder, updateOrderItems } from "@/lib/order-rpcs";
import type { ProductOption, RetailerOption, EditOrderData } from "./page";

type Step = "retailer" | "order" | "review" | "confirmation";

interface ConfirmedOrder {
  orderRef: string;
  totalPaise: number;
}

interface FlowState {
  step: Step;
  cart: DraftCart | null;
  retailerArea: string | null;
  resumeCandidate: DraftCart | null;
  confirmed: ConfirmedOrder | null;
  submitting: boolean;
  submitError: string | null;
}

type FlowAction =
  | { type: "SELECT_RETAILER"; cart: DraftCart; retailerArea: string | null }
  | { type: "CHANGE_RETAILER_EDIT"; retailerId: string; retailerName: string; retailerArea: string | null }
  | { type: "OFFER_RESUME"; draft: DraftCart }
  | { type: "RESUME_ON_MOUNT"; draft: DraftCart; retailerArea: string | null }
  | { type: "CONTINUE_RESUME_CANDIDATE" }
  | { type: "START_FRESH_FROM_RESUME"; cart: DraftCart }
  | { type: "DISMISS_RESUME" }
  | { type: "CHANGE_QTY"; productId: string; qty: number }
  | { type: "CHANGE_PRICE"; productId: string; pricePaise: number }
  | { type: "SET_NOTES"; notes: string }
  | { type: "GOTO_STEP"; step: Step }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "SUBMIT_SUCCESS_CREATE"; confirmed: ConfirmedOrder };

function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "SELECT_RETAILER":
      return { ...state, cart: action.cart, retailerArea: action.retailerArea, step: "order" };
    case "CHANGE_RETAILER_EDIT":
      // Admin-only, edit flow: swap the order's retailer in place (no draft/
      // localStorage — this order already exists) and return to Review.
      return state.cart
        ? {
            ...state,
            cart: { ...state.cart, retailerId: action.retailerId, retailerName: action.retailerName },
            retailerArea: action.retailerArea,
            step: "review",
          }
        : state;
    case "OFFER_RESUME":
      return { ...state, resumeCandidate: action.draft };
    case "RESUME_ON_MOUNT":
      return {
        ...state,
        cart: action.draft,
        retailerArea: action.retailerArea,
        step: "review",
      };
    case "CONTINUE_RESUME_CANDIDATE":
      return state.resumeCandidate
        ? { ...state, cart: state.resumeCandidate, resumeCandidate: null, step: "order" }
        : state;
    case "START_FRESH_FROM_RESUME":
      return { ...state, cart: action.cart, resumeCandidate: null, step: "order" };
    case "DISMISS_RESUME":
      return { ...state, resumeCandidate: null };
    case "CHANGE_QTY": {
      if (!state.cart) return state;
      const items = { ...state.cart.items };
      if (action.qty <= 0) delete items[action.productId];
      else items[action.productId] = action.qty;
      return { ...state, cart: { ...state.cart, items, updatedAt: nowMs() } };
    }
    case "CHANGE_PRICE": {
      if (!state.cart) return state;
      const prices = { ...(state.cart.prices ?? {}) };
      if (action.pricePaise > 0) prices[action.productId] = action.pricePaise;
      else delete prices[action.productId];
      return { ...state, cart: { ...state.cart, prices, updatedAt: nowMs() } };
    }
    case "SET_NOTES":
      return state.cart ? { ...state, cart: { ...state.cart, notes: action.notes, updatedAt: nowMs() } } : state;
    case "GOTO_STEP":
      return { ...state, step: action.step };
    case "SUBMIT_START":
      return { ...state, submitting: true, submitError: null };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, submitError: action.message };
    case "SUBMIT_SUCCESS_CREATE":
      return { ...state, submitting: false, submitError: null, confirmed: action.confirmed, step: "confirmation" };
    default:
      return state;
  }
}

interface NewOrderFlowProps {
  products: ProductOption[];
  retailers: RetailerOption[];
  recentRetailerIds: string[];
  editOrder: EditOrderData | null;
  salesmanId: string;
  // Detail route for THIS creator's role — staff open the order on the staff
  // workbench (/dashboard/orders, with Approve etc.), the salesman on his own
  // lens (/orders). Without this, an admin who creates an order and taps "View
  // order" lands on the salesman lens (no Approve).
  detailBase: string;
  // Admin gets the extra edit powers: change the retailer and override any
  // line's price (fixed brands included). Only meaningful in the EDIT flow — a
  // CREATE goes through submit_order, which ignores both (untamperable holds).
  isAdmin: boolean;
  // A reason is required for this specific edit (admin past approval) — the
  // final Confirm opens a reason BottomSheet instead of submitting straight.
  requiresReason: boolean;
}

export function NewOrderFlow({ products, retailers, recentRetailerIds, editOrder, salesmanId, detailBase, isAdmin, requiresReason }: NewOrderFlowProps) {
  const router = useRouter();
  const isEdit = editOrder !== null;
  // Admin edit powers, scoped to the edit flow only.
  const canPriceAll = isAdmin && isEdit;
  const canChangeRetailer = isAdmin && isEdit;

  const pricesById: Record<string, number> = {};
  for (const p of products) if (p.price_paise != null) pricesById[p.id] = p.price_paise;
  const catalogIds = new Set(products.map((p) => p.id));

  // ㉕ (create mode only) — a resumed draft can name a product that's since
  // left the active+priced catalog. Unlike an edit, a create-draft has no
  // order_items snapshot to fall back on for its name/price, so there's
  // nothing meaningful to show or submit for it; drop it here rather than
  // let it ride along invisibly and reject the whole submit_order call.
  function pruneStaleItems(draft: DraftCart): DraftCart {
    const items: Record<string, number> = {};
    for (const [id, qty] of Object.entries(draft.items)) {
      if (catalogIds.has(id)) items[id] = qty;
    }
    return { ...draft, items };
  }

  const [state, dispatch] = useReducer(flowReducer, null, (): FlowState => ({
    step: isEdit ? "order" : "retailer",
    cart: isEdit
      ? {
          orderId: editOrder!.id,
          retailerId: editOrder!.retailerId,
          retailerName: editOrder!.retailerName,
          items: editOrder!.items,
          // Seed entered prices from the order's current unit prices so a
          // manual (LG) line shows its price to edit; fixed brands ignore it.
          prices: editOrder!.snapshotPrices,
          notes: editOrder!.notes,
          updatedAt: 0,
        }
      : null,
    retailerArea: isEdit ? editOrder!.retailerArea : null,
    resumeCandidate: null,
    confirmed: null,
    submitting: false,
    submitError: null,
  }));

  const { step, cart, retailerArea, resumeCandidate, confirmed, submitting, submitError } = state;

  // Reason BottomSheet (admin post-approval edit) — the final Confirm opens it
  // instead of submitting; an empty reason blocks the save.
  const [reasonSheetOpen, setReasonSheetOpen] = useState(false);
  const [reasonText, setReasonText] = useState("");

  // Reopen-the-app resilience (acceptance criterion #2): if a draft was left
  // mid-cart, resume it directly instead of forcing a re-pick through S3. A
  // single dispatch applies every piece of resumed state atomically.
  useEffect(() => {
    if (isEdit) return;
    const lastRetailerId = getLastActiveRetailerId();
    if (!lastRetailerId) return;
    const loaded = loadDraft(lastRetailerId);
    if (!loaded) return;
    const draft = pruneStaleItems(loaded);
    if (Object.keys(draft.items).length === 0) return;
    const retailer = retailers.find((r) => r.id === lastRetailerId);
    dispatch({ type: "RESUME_ON_MOUNT", draft, retailerArea: retailer?.area ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(next: DraftCart) {
    if (!isEdit) {
      saveDraft(next);
      setLastActiveRetailerId(next.retailerId);
    }
  }

  function handleSelectRetailer(retailer: SelectedRetailer) {
    // Admin edit: changing the retailer on an existing order — no draft/resume
    // machinery (that's create-only); swap it in place and return to Review.
    if (isEdit) {
      dispatch({
        type: "CHANGE_RETAILER_EDIT",
        retailerId: retailer.id,
        retailerName: retailer.name,
        retailerArea: retailer.area,
      });
      return;
    }
    const existing = loadDraft(retailer.id);
    const pruned = existing ? pruneStaleItems(existing) : null;
    if (pruned && Object.keys(pruned.items).length > 0) {
      dispatch({ type: "OFFER_RESUME", draft: pruned });
      return;
    }
    const draft = createDraft(retailer.id, retailer.name);
    persist(draft);
    dispatch({ type: "SELECT_RETAILER", cart: draft, retailerArea: retailer.area });
  }

  function handleChangeQty(productId: string, qty: number) {
    dispatch({ type: "CHANGE_QTY", productId, qty });
  }

  function handleChangePrice(productId: string, pricePaise: number) {
    dispatch({ type: "CHANGE_PRICE", productId, pricePaise });
  }

  function handleNotesChange(notes: string) {
    dispatch({ type: "SET_NOTES", notes });
  }

  // The final Confirm on Review: a reason-required edit (admin past approval)
  // opens the reason sheet; every other case submits straight.
  function handleReviewSubmit() {
    if (requiresReason) {
      setReasonSheetOpen(true);
      return;
    }
    handleSubmit();
  }

  async function handleSubmit(reason?: string) {
    if (!cart) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      // Only send the retailer when an admin actually changed it — otherwise the
      // RPC would log a spurious retailer_changed on every edit.
      const retailerChanged = isEdit && editOrder !== null && cart.retailerId !== editOrder.retailerId;
      const order = isEdit
        ? await updateOrderItems(
            cart.orderId,
            cart.notes,
            cart.items,
            reason,
            cart.prices,
            retailerChanged ? cart.retailerId : undefined,
          )
        : await submitOrder(cart.orderId, cart.retailerId, cart.notes, cart.items, cart.prices);

      if (!isEdit) {
        clearDraft(cart.retailerId);
        clearLastActiveRetailerId();
        dispatch({
          type: "SUBMIT_SUCCESS_CREATE",
          confirmed: { orderRef: order.order_ref, totalPaise: order.total_paise },
        });
      } else {
        setReasonSheetOpen(false);
        router.push(`${detailBase}/${cart.orderId}`);
      }
    } catch (error) {
      // Offline queue removed (owner decision 2026-07-10): a transport failure
      // surfaces OfflineError's own "You're offline…" message through the same
      // strip as any rejection — the salesman retries when he has signal (the
      // idempotent orderId means a retry never duplicates), or writes it down.
      dispatch({ type: "SUBMIT_ERROR", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  }

  // Effect-driven side effects for actions that write to localStorage
  // (persist runs from the same event that dispatches, not from a re-render).
  function goto(next: Step) {
    dispatch({ type: "GOTO_STEP", step: next });
  }

  useEffect(() => {
    if (!isEdit && cart) persist(cart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  if (step === "retailer") {
    return (
      <>
        <PickRetailer
          retailers={retailers}
          recentRetailerIds={recentRetailerIds}
          salesmanId={salesmanId}
          onSelect={handleSelectRetailer}
          onBack={() => (isEdit ? goto("review") : router.push("/"))}
        />
        {resumeCandidate && (
          <BottomSheet onClose={() => dispatch({ type: "DISMISS_RESUME" })}>
            <p>
              Continue order for {resumeCandidate.retailerName}? · {Object.keys(resumeCandidate.items).length} items ·{" "}
              {formatRupees(cartTotalPaise(resumeCandidate.items, { ...pricesById, ...(resumeCandidate.prices ?? {}) }))} ·
              saved{" "}
              {new Date(resumeCandidate.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}{" "}
              on this phone
            </p>
            <Button variant="primary" onClick={() => dispatch({ type: "CONTINUE_RESUME_CANDIDATE" })}>
              Continue order
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                clearDraft(resumeCandidate.retailerId);
                dispatch({
                  type: "START_FRESH_FROM_RESUME",
                  cart: createDraft(resumeCandidate.retailerId, resumeCandidate.retailerName),
                });
              }}
            >
              Start fresh
            </Button>
          </BottomSheet>
        )}
      </>
    );
  }

  if (!cart) {
    // Defensive — order/review/confirmation all require a cart. Should be
    // unreachable given the step transitions above.
    return null;
  }

  if (step === "order") {
    return (
      <QuickOrder
        products={products}
        retailerName={cart.retailerName}
        retailerArea={retailerArea}
        items={cart.items}
        prices={cart.prices ?? {}}
        snapshotPrices={isEdit ? editOrder!.snapshotPrices : undefined}
        snapshotNames={isEdit ? editOrder!.snapshotNames : undefined}
        canPriceAll={canPriceAll}
        onChangeQty={handleChangeQty}
        onChangePrice={handleChangePrice}
        onReview={() => goto("review")}
        onBack={() => (isEdit ? router.push(`${detailBase}/${cart.orderId}`) : goto("retailer"))}
      />
    );
  }

  if (step === "review") {
    return (
      <>
        <Review
          products={products}
          prices={cart.prices ?? {}}
          snapshotPrices={isEdit ? editOrder!.snapshotPrices : undefined}
          snapshotNames={isEdit ? editOrder!.snapshotNames : undefined}
          items={cart.items}
          notes={cart.notes}
          retailerName={cart.retailerName}
          retailerArea={retailerArea}
          isEdit={isEdit}
          canChangeRetailer={canChangeRetailer}
          onChangeQty={handleChangeQty}
          onNotesChange={handleNotesChange}
          onChangeRetailer={() => goto("retailer")}
          onBack={() => goto("order")}
          onSubmit={handleReviewSubmit}
          submitting={submitting}
          submitError={submitError}
        />
        {reasonSheetOpen && (
          <BottomSheet onClose={() => setReasonSheetOpen(false)}>
            <div className={styles.reasonSheet}>
              <p className={styles.reasonTitle}>Reason for this change?</p>
              <p className={styles.reasonBody}>Editing an approved order — the reason is logged to the order history.</p>
              <label className={styles.reasonLabel}>REASON (required)</label>
              <textarea
                className={styles.reasonInput}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="e.g. shop called with a correction"
                autoFocus
              />
              {submitError && <p className={styles.error}>{submitError}</p>}
              <div className={styles.reasonActions}>
                <Button variant="secondary" onClick={() => setReasonSheetOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleSubmit(reasonText.trim())}
                  loading={submitting}
                  disabled={!reasonText.trim()}
                >
                  Save changes
                </Button>
              </div>
            </div>
          </BottomSheet>
        )}
      </>
    );
  }

  if (step === "confirmation" && confirmed) {
    return (
      <Confirmation
        orderRef={confirmed.orderRef}
        totalPaise={confirmed.totalPaise}
        retailerName={cart.retailerName}
        onBackHome={() => router.push("/")}
        onViewOrder={() => router.push(`${detailBase}/${cart.orderId}`)}
      />
    );
  }

  return null;
}
