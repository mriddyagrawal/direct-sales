import { createClient } from "@/lib/supabase/client";
import { getQueryClient } from "@/lib/query-client";
import type { Database } from "@/lib/types/database.types";

export type DepositRow = Database["public"]["Tables"]["deposits"]["Row"];
export type DepositMethod = "cash" | "cheque" | "online";

interface RpcErrorLike {
  message: string;
  code?: string;
}

// Same thin callRpc shape as order-rpcs.ts (without the offline classifier —
// a deposit is recorded standing in the shop; on failure the message shows and
// the salesman taps Save again; nothing queues).
async function callRpc<T>(fn: () => PromiseLike<{ data: T | null; error: RpcErrorLike | null }>): Promise<T> {
  const result = await fn();
  if (result.error) throw new Error(result.error.message);
  // D7 (client-data-cache spec): every RPC in this file mutates `deposits` —
  // one success hook invalidates the ["deposits"] cache prefix so the actor's
  // ledger corrects without a manual reload (same pattern as order-rpcs).
  void getQueryClient().invalidateQueries({ queryKey: ["deposits"] });
  return result.data as T;
}

// Record a collection (salesman/accountant/admin; the RPC re-checks the role).
// salesman_id = the caller; editable_until = +1 hour (both server-set). Amount
// is integer paise, > 0 — parsePricePaise upstream, never a float.
export async function createDeposit(
  retailerId: string,
  amountPaise: number,
  method: DepositMethod,
  note?: string,
): Promise<DepositRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("create_deposit", {
      p_retailer_id: retailerId,
      p_amount_paise: amountPaise,
      p_method: method,
      p_note: note,
    }),
  );
}

// Correct a deposit — the creating salesman within his 1-hour window, or an
// admin anytime (server-enforced; past the window the RPC raises "locked").
// Only retailer/amount/method/note ever change.
export async function updateDeposit(
  id: string,
  retailerId: string,
  amountPaise: number,
  method: DepositMethod,
  note?: string,
): Promise<DepositRow> {
  const supabase = createClient();
  return callRpc(() =>
    supabase.rpc("update_deposit", {
      p_id: id,
      p_retailer_id: retailerId,
      p_amount_paise: amountPaise,
      p_method: method,
      p_note: note,
    }),
  );
}

// Remove a deposit = VOID it (owner 2026-07-19: nothing is ever hard-deleted).
// The row stays — struck, excluded from totals, audited. Reason REQUIRED for
// everyone; allowed for the creator within his 1-hour window or an admin
// anytime (server-enforced).
export async function voidDeposit(id: string, reason: string): Promise<DepositRow> {
  const supabase = createClient();
  return callRpc(() => supabase.rpc("void_deposit", { p_id: id, p_reason: reason }));
}
