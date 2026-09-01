// Edge Function `whatsapp-receipt` — deposit → WhatsApp receipt, SEND-ONLY
// (owner 2026-09-01; the Meta→us webhook receiver lives on the
// feat/whatsapp-webhooks branch, deliberately split out pending the owner's
// call — merging that branch restores it to this same function).
//
// One caller: the DB trigger (whatsapp_receipt_webhook() on deposit_events
// INSERT, action 'created', x-trigger-secret header). Sends the approved
// `receipt_with_discount` utility template to the retailer, filled from the
// event's own snapshot — the salesman never touches the message.
//
// OUTSTANDING IS AUTO-PULLED (owner 2026-09-01, reversing the typed-field
// design after live use): previous = retailers.outstanding_paise, the Tally
// sync's figure, null treated as 0 (owner: "zeros and positives don't
// matter, just do basic math"); current = previous − net, negative fine
// (an advance). The figures QUOTED to the retailer are logged in the
// receipt_sent event details — the row no longer stores them, the trail is
// the record of what was said. Known cost, owner-accepted: the sync figure
// is as-of-last-run, so two same-day deposits quote the same "previous".
//
// Logged back into deposit_events as receipt_sent / receipt_failed —
// visible in the dashboard's edit-trail UI, and a safe no-op in `notify`
// (its depositCards only knows created/voided).
//
// A message must NEVER block or break the deposit it rides on: every path
// here fails soft.
//
// Secrets (function store): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WA_TRIGGER_SECRET. SUPABASE_URL / SERVICE_ROLE injected.
import { createClient } from "npm:@supabase/supabase-js@2";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const TRIGGER_SECRET = Deno.env.get("WA_TRIGGER_SECRET") ?? "";
const TEMPLATE_NAME = "receipt_with_discount";

function service() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Bare en-IN grouped figure — the template's body already carries the ₹
// before each amount slot, so params must NOT repeat it. Paise in, string out
// (house rule: never a raw paise integer near a human).
function inr(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  return sign + (Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const METHOD_LABEL: Record<string, string> = { cash: "Cash", cheque: "Cheque", online: "Online" };

// "+91 70002 51951" / "07000251951" / "7000251951" → "917000251951".
// Anything that doesn't resolve to a 10-digit Indian mobile is a logged skip.
function e164India(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length === 12 && d.startsWith("91") ? d : null;
}

interface DepositEventRecord {
  id: number;
  deposit_id: string;
  actor_id: string | null;
  action: string;
  details: {
    retailer_id?: string;
    amount_paise?: number;
    discount_paise?: number;
    previous_outstanding_paise?: number | null;
    receipt_ref?: string | null;
    method?: string;
    note?: string | null;
  };
}

async function logEvent(depositId: string, action: string, details: Record<string, unknown>) {
  await service().from("deposit_events").insert({ deposit_id: depositId, actor_id: null, action, details });
}

// ---- the DB trigger -------------------------------------------------------
async function handleDepositCreated(record: DepositEventRecord): Promise<Response> {
  const d = record.details;
  const db = service();

  // Idempotency: pg_net can retry — one receipt per deposit, ever.
  const { data: already } = await db
    .from("deposit_events")
    .select("id")
    .eq("deposit_id", record.deposit_id)
    .eq("action", "receipt_sent")
    .limit(1);
  if (already && already.length > 0) return Response.json({ skipped: "already sent" });

  const [{ data: retailer }, { data: actor }] = await Promise.all([
    db.from("retailers").select("name, phone, outstanding_paise").eq("id", d.retailer_id!).maybeSingle(),
    record.actor_id
      ? db.from("profiles").select("full_name").eq("id", record.actor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const r = retailer as { phone: string | null; outstanding_paise: number | null } | null;

  const to = e164India(r?.phone ?? null);
  if (!to) {
    await logEvent(record.deposit_id, "receipt_failed", { reason: "retailer has no usable phone number" });
    return Response.json({ skipped: "no phone" });
  }

  const amount = d.amount_paise ?? 0;
  const discount = d.discount_paise ?? 0;
  const net = amount - discount;
  // The Tally sync's figure; null (never-synced shop) = 0 by owner's rule.
  const prev = r?.outstanding_paise ?? 0;
  const params = {
    salesperson: (actor as { full_name: string } | null)?.full_name ?? "our salesperson",
    received_amount: inr(net),
    payment_method: METHOD_LABEL[d.method ?? ""] ?? d.method ?? "-",
    discount: inr(discount),
    initial_amount: inr(amount),
    previous_outstanding: inr(prev),
    current_outstanding: inr(prev - net),
    number_if_cheque: d.method === "cheque" && d.note ? `Cheque no: ${d.note}` : "-",
  };

  const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: Object.entries(params).map(([parameter_name, text]) => ({
              type: "text",
              parameter_name,
              text,
            })),
          },
        ],
      },
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (res.ok && body.messages?.[0]?.id) {
    // The quoted figures ride the event — the deposit row no longer stores
    // them; this is the durable record of what the retailer was told.
    await logEvent(record.deposit_id, "receipt_sent", {
      wamid: body.messages[0].id,
      to,
      previous_outstanding_paise: prev,
      current_outstanding_paise: prev - net,
    });
    return Response.json({ sent: true });
  }
  await logEvent(record.deposit_id, "receipt_failed", {
    reason: body.error?.message ?? `HTTP ${res.status}`,
    code: body.error?.code ?? null,
  });
  return Response.json({ sent: false });
}

// ---- router ---------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (req.headers.get("x-trigger-secret") !== TRIGGER_SECRET || TRIGGER_SECRET === "") {
      return new Response("forbidden", { status: 403 });
    }
    const payload = await req.json().catch(() => null);
    const record = (payload as { record?: DepositEventRecord } | null)?.record;
    if (record?.action === "created") return await handleDepositCreated(record);
    return Response.json({ skipped: "not a created event" });
  } catch (err) {
    // Fail soft, always: nothing here may ever matter more than the deposit
    // that was saved.
    console.error("whatsapp-receipt error:", err);
    return Response.json({ ok: false });
  }
});
