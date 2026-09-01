// Edge Function `whatsapp-receipt` — the deposit → WhatsApp receipt pipeline
// (owner 2026-09-01). Three callers, one function:
//
//   1. The DB trigger (whatsapp_receipt_webhook() on deposit_events INSERT,
//      action 'created', x-trigger-secret header): sends the approved
//      `receipt_with_discount` utility template to the retailer, filled from
//      the event's own snapshot — the salesman never touches the message.
//      OUTSTANDING IS AUTO-PULLED (owner 2026-09-01, reversing the
//      typed-field design after live use): previous =
//      retailers.outstanding_paise (the Tally sync's figure, null = 0 by
//      owner's rule), current = previous − net, negative fine (an advance).
//      The quoted figures ride the receipt_sent event details — the trail is
//      the durable record of what was said. Known, owner-accepted cost: the
//      sync figure is as-of-last-run, so two same-day deposits quote the
//      same "previous". Logged as receipt_sent / receipt_failed; a safe
//      no-op in `notify` (its depositCards only knows created/voided).
//
//   2. Meta's webhook VERIFY (GET hub.challenge + verify token).
//
//   3. Meta's webhook EVENTS (POST, gated by ?vt=<verify token> in the
//      callback URL): delivery statuses update the trail
//      (receipt_delivered / receipt_failed); an inbound REPLY — the
//      template says "reply if something looks wrong", the anti-fraud
//      tripwire — is pinned to the latest receipt sent to that phone as a
//      reply_received event.
//
// A message must NEVER block or break the deposit it rides on: every path
// here fails soft and answers 200 to Meta (who retries hard on non-200).
//
// Secrets (function store): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WA_VERIFY_TOKEN, WA_TRIGGER_SECRET. SUPABASE_URL / SERVICE_ROLE injected.
import { createClient } from "npm:@supabase/supabase-js@2";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
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

// ---- caller 1: the DB trigger --------------------------------------------
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
  // The outstanding drops by the GROSS, not the net (owner 2026-09-01): the
  // office books TWO Tally lines from one deposit — receipt ₹9,500 +
  // discount ₹500 — so the ledger falls by the full ₹10,000. The message's
  // "collected" stays the net (what changed hands); the deduction is gross.
  const current = prev - amount;
  const params = {
    salesperson: (actor as { full_name: string } | null)?.full_name ?? "our salesperson",
    received_amount: inr(net),
    payment_method: METHOD_LABEL[d.method ?? ""] ?? d.method ?? "-",
    discount: inr(discount),
    initial_amount: inr(amount),
    previous_outstanding: inr(prev),
    current_outstanding: inr(current),
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
      current_outstanding_paise: current,
    });
    return Response.json({ sent: true });
  }
  await logEvent(record.deposit_id, "receipt_failed", {
    reason: body.error?.message ?? `HTTP ${res.status}`,
    code: body.error?.code ?? null,
  });
  return Response.json({ sent: false });
}

// ---- caller 3: Meta's event webhook --------------------------------------
interface MetaStatus {
  id: string;
  status: string;
  errors?: { code: number; title?: string; message?: string }[];
}
interface MetaMessage {
  from: string;
  id: string;
  text?: { body: string };
  type: string;
}

async function findDepositByWamid(db: ReturnType<typeof service>, wamid: string): Promise<string | null> {
  const { data } = await db
    .from("deposit_events")
    .select("deposit_id")
    .eq("action", "receipt_sent")
    .eq("details->>wamid", wamid)
    .limit(1);
  return data?.[0]?.deposit_id ?? null;
}

async function handleMetaEvents(payload: unknown): Promise<Response> {
  const db = service();
  const entries = (payload as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] }).entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const s of (value.statuses as MetaStatus[] | undefined) ?? []) {
        if (s.status !== "delivered" && s.status !== "failed") continue; // sent/read: noise
        const depositId = await findDepositByWamid(db, s.id);
        if (!depositId) continue;
        const action = s.status === "delivered" ? "receipt_delivered" : "receipt_failed";
        // Dedupe: Meta re-delivers webhooks; one trail line per outcome.
        const { data: dup } = await db
          .from("deposit_events")
          .select("id")
          .eq("deposit_id", depositId)
          .eq("action", action)
          .eq("details->>wamid", s.id)
          .limit(1);
        if (dup && dup.length > 0) continue;
        await logEvent(depositId, action, {
          wamid: s.id,
          ...(s.errors?.length ? { reason: s.errors[0].message ?? s.errors[0].title ?? `code ${s.errors[0].code}` } : {}),
        });
      }

      for (const m of (value.messages as MetaMessage[] | undefined) ?? []) {
        if (m.type !== "text" || !m.text?.body) continue;
        // Pin the reply to the LATEST receipt sent to this phone — the
        // "reply if something looks wrong" tripwire, visible in the trail.
        const { data: recent } = await db
          .from("deposit_events")
          .select("deposit_id, created_at")
          .eq("action", "receipt_sent")
          .eq("details->>to", m.from)
          .order("created_at", { ascending: false })
          .limit(1);
        const depositId = recent?.[0]?.deposit_id;
        if (!depositId) continue;
        await logEvent(depositId, "reply_received", { from: m.from, text: m.text.body.slice(0, 500) });
      }
    }
  }
  return Response.json({ ok: true });
}

// ---- router ---------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);

    // Meta webhook verification handshake.
    if (req.method === "GET") {
      if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    }

    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const payload = await req.json().catch(() => null);
    if (!payload) return new Response("bad request", { status: 400 });

    // Our DB trigger.
    if (req.headers.get("x-trigger-secret") === TRIGGER_SECRET && TRIGGER_SECRET !== "") {
      const record = (payload as { record?: DepositEventRecord }).record;
      if (record?.action === "created") return await handleDepositCreated(record);
      return Response.json({ skipped: "not a created event" });
    }

    // Meta events — the callback URL carries ?vt=<verify token>, our gate
    // against forged POSTs (Meta preserves the query string it verified).
    if ((payload as { object?: string }).object === "whatsapp_business_account") {
      if (url.searchParams.get("vt") !== VERIFY_TOKEN || VERIFY_TOKEN === "") {
        return new Response("forbidden", { status: 403 });
      }
      return await handleMetaEvents(payload);
    }

    return new Response("forbidden", { status: 403 });
  } catch (err) {
    // Fail soft, always: a broken webhook must not make Meta hammer retries,
    // and nothing here may ever matter more than the deposit that was saved.
    console.error("whatsapp-receipt error:", err);
    return Response.json({ ok: false });
  }
});
