"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { PickRetailer, type SelectedRetailer } from "./PickRetailer";
import { QuickOrder } from "./QuickOrder";
import { Review } from "./Review";
import { Confirmation } from "./Confirmation";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { formatRupees } from "@/lib/format";
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
import { listPending, savePending, removePending } from "@/lib/pending-orders";
import { submitOrder, updateOrderItems, OfflineError } from "@/lib/order-rpcs";
import type { ProductOption, RetailerOption, EditOrderData } from "./page";

type Step = "retailer" | "order" | "review" | "confirmation";

interface ConfirmedOrder {
  orderRef: string;
  totalPaise: number;
  editableUntil: string;
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
  | { type: "OFFER_RESUME"; draft: DraftCart }
  | { type: "RESUME_ON_MOUNT"; draft: DraftCart; retailerArea: string | null; offline: boolean }
  | { type: "CONTINUE_RESUME_CANDIDATE" }
  | { type: "START_FRESH_FROM_RESUME"; cart: DraftCart }
  | { type: "DISMISS_RESUME" }
  | { type: "CHANGE_QTY"; productId: string; qty: number }
  | { type: "CHANGE_PRICE"; productId: string; pricePaise: number }
  | { type: "SET_NOTES"; notes: string }
  | { type: "GOTO_STEP"; step: Step }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_OFFLINE" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "SUBMIT_SUCCESS_CREATE"; confirmed: ConfirmedOrder };

function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "SELECT_RETAILER":
      return { ...state, cart: action.cart, retailerArea: action.retailerArea, step: "order" };
    case "OFFER_RESUME":
      return { ...state, resumeCandidate: action.draft };
    case "RESUME_ON_MOUNT":
      return {
        ...state,
        cart: action.draft,
        retailerArea: action.retailerArea,
        step: "review",
        submitError: action.offline ? "offline" : state.submitError,
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
    case "SUBMIT_OFFLINE":
      return { ...state, submitting: false, submitError: "offline" };
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
}

export function NewOrderFlow({ products, retailers, recentRetailerIds, editOrder, salesmanId }: NewOrderFlowProps) {
  const router = useRouter();
  const isEdit = editOrder !== null;

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
    const offline = listPending().some((p) => p.orderId === draft.orderId);
    const retailer = retailers.find((r) => r.id === lastRetailerId);
    dispatch({ type: "RESUME_ON_MOUNT", draft, retailerArea: retailer?.area ?? null, offline });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(next: DraftCart) {
    if (!isEdit) {
      saveDraft(next);
      setLastActiveRetailerId(next.retailerId);
    }
  }

  function handleSelectRetailer(retailer: SelectedRetailer) {
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

  async function handleSubmit() {
    if (!cart) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const order = isEdit
        ? await updateOrderItems(cart.orderId, cart.notes, cart.items, undefined, cart.prices)
        : await submitOrder(cart.orderId, cart.retailerId, cart.notes, cart.items, cart.prices);

      removePending(cart.orderId);
      if (!isEdit) {
        clearDraft(cart.retailerId);
        clearLastActiveRetailerId();
        dispatch({
          type: "SUBMIT_SUCCESS_CREATE",
          confirmed: { orderRef: order.order_ref, totalPaise: order.total_paise, editableUntil: order.editable_until },
        });
      } else {
        router.push(`/orders/${cart.orderId}`);
      }
    } catch (error) {
      if (error instanceof OfflineError) {
        if (!isEdit) {
          savePending({
            orderId: cart.orderId,
            retailerId: cart.retailerId,
            retailerName: cart.retailerName,
            notes: cart.notes,
            items: cart.items,
            prices: cart.prices,
            itemCount: Object.keys(cart.items).length,
            totalPaise: cartTotalPaise(cart.items, { ...pricesById, ...(cart.prices ?? {}) }),
            savedAt: nowMs(),
          });
        }
        dispatch({ type: "SUBMIT_OFFLINE" });
      } else {
        dispatch({ type: "SUBMIT_ERROR", message: error instanceof Error ? error.message : "Something went wrong." });
      }
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
          onBack={() => router.push("/")}
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
        onChangeQty={handleChangeQty}
        onChangePrice={handleChangePrice}
        onReview={() => goto("review")}
        onBack={() => (isEdit ? router.push(`/orders/${cart.orderId}`) : goto("retailer"))}
      />
    );
  }

  if (step === "review") {
    return (
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
        onChangeQty={handleChangeQty}
        onNotesChange={handleNotesChange}
        onChangeRetailer={() => goto("retailer")}
        onBack={() => goto("order")}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitError={submitError}
      />
    );
  }

  if (step === "confirmation" && confirmed) {
    return (
      <Confirmation
        orderRef={confirmed.orderRef}
        totalPaise={confirmed.totalPaise}
        retailerName={cart.retailerName}
        editableUntil={confirmed.editableUntil}
        onBackHome={() => router.push("/")}
        onViewOrder={() => router.push(`/orders/${cart.orderId}`)}
      />
    );
  }

  return null;
}
