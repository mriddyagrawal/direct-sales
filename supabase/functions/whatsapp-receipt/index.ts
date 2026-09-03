// Edge Function `whatsapp-receipt` — the deposit → WhatsApp pipeline, v2
// (owner 2026-09-03, void-only era). Three callers, one function:
//
//   1. The DB trigger (whatsapp_receipt_webhook() on deposit_events INSERT,
//      actions 'created' AND 'voided', x-trigger-secret header):
//        · created → retailer receipt (`receipt_with_discount_v2`, or the
//          `..._with_cheque_v2` variant when method=cheque — a SEPARATE
//          approved template, so no "-" filler line ever) + the owner alert
//          (`owner_deposit_alert`) to OWNER_PHONE (dad).
//        · voided → retailer cancellation (`receipt_voided`) + the owner
//          void alert (`owner_deposit_void_alert_with_payment_method`) with
//          the voider's name and quoted reason — the anti-fraud tripwire.
//      OUTSTANDING IS AUTO-PULLED: previous = retailers.outstanding_paise
//      (Tally sync figure, null = 0 by owner's rule), current = previous −
//      GROSS (the ledger falls by receipt + discount lines), negative fine.
//      Two same-day deposits quote the same "previous" (owner-accepted:
//      the sync figure is as-of-last-run). Template params are NAMED and
//      must match the approved templates character-for-character — the
//      roster + params were read off the Graph API 2026-09-03.
//
//   2. Meta's webhook VERIFY (GET hub.challenge + verify token).
//
//   3. Meta's webhook EVENTS (POST, gated by ?vt=<verify token> in the
//      callback URL): delivery statuses update the trail for EVERY message
//      kind (receipt / void notice / owner alerts — matched by wamid across
//      all *_sent events); an inbound retailer REPLY is pinned to the
//      latest receipt sent to that phone as reply_received. Texts from
//      OWNER_PHONE are ignored — dad uses the app, not the tripwire.
//
// A message must NEVER block or break the deposit it rides on: every path
// fails soft and answers 200 to Meta (who retries hard on non-200). Every
// send is idempotent per (deposit, kind) — pg_net can retry.
//
// Secrets (function store): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WA_VERIFY_TOKEN, WA_TRIGGER_SECRET, OWNER_PHONE. SUPABASE_URL /
// SERVICE_ROLE injected.
import { createClient } from "npm:@supabase/supabase-js@2";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const TRIGGER_SECRET = Deno.env.get("WA_TRIGGER_SECRET") ?? "";
const OWNER_PHONE = Deno.env.get("OWNER_PHONE") ?? "";

// Approved template roster (Graph API read, 2026-09-03) — names + param
// names are load-bearing: a mismatch is a rejected send.
const T_RECEIPT = "receipt_with_discount_v2";
const T_RECEIPT_CHEQUE = "receipt_with_discount_with_cheque_v2";
const T_RECEIPT_VOIDED = "receipt_voided";
const T_OWNER_ALERT = "owner_deposit_alert";
const T_OWNER_VOID = "owner_deposit_void_alert_with_payment_method";

function service() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Bare en-IN grouped figure — the template bodies carry the ₹ before each
// amount slot, so params must NOT repeat it. Paise in, string out (house
// rule: never a raw paise integer near a human).
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
    receipt_ref?: string | null;
    method?: string;
    note?: string | null;
    reason?: string;
  };
}

async function logEvent(depositId: string, action: string, details: Record<string, unknown>) {
  await service().from("deposit_events").insert({ deposit_id: depositId, actor_id: null, action, details });
}

// Idempotency: pg_net can retry — one message per (deposit, kind), ever.
async function alreadySent(db: ReturnType<typeof service>, depositId: string, action: string): Promise<boolean> {
  const { data } = await db
    .from("deposit_events")
    .select("id")
    .eq("deposit_id", depositId)
    .eq("action", action)
    .limit(1);
  return !!data && data.length > 0;
}

async function actorName(db: ReturnType<typeof service>, actorId: string | null): Promise<string> {
  if (!actorId) return "the office";
  const { data } = await db.from("profiles").select("full_name").eq("id", actorId).maybeSingle();
  return (data as { full_name: string } | null)?.full_name ?? "the office";
}

// Shared template sender. Returns the wamid on success, the refusal on
// failure — the CALLER logs, so each message kind keeps its own trail verb.
async function sendTemplate(
  to: string,
  template: string,
  params: Record<string, string>,
): Promise<{ ok: true; wamid: string } | { ok: false; reason: string; code: number | null }> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template,
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
  if (res.ok && body.messages?.[0]?.id) return { ok: true, wamid: body.messages[0].id };
  return { ok: false, reason: body.error?.message ?? `HTTP ${res.status}`, code: body.error?.code ?? null };
}

// ---- trigger caller: action 'created' -------------------------------------
async function handleDepositCreated(record: DepositEventRecord): Promise<Response> {
  const d = record.details;
  const db = service();

  const [{ data: retailer }, salesperson] = await Promise.all([
    db.from("retailers").select("name, phone, outstanding_paise").eq("id", d.retailer_id!).maybeSingle(),
    actorName(db, record.actor_id),
  ]);
  const r = retailer as { name: string; phone: string | null; outstanding_paise: number | null } | null;

  const amount = d.amount_paise ?? 0;
  const discount = d.discount_paise ?? 0;
  const net = amount - discount;
  // The Tally sync's figure; null (never-synced shop) = 0 by owner's rule.
  // The outstanding drops by the GROSS (owner 2026-09-01): the office books
  // TWO Tally lines from one deposit — receipt + discount — so the ledger
  // falls by the full amount while "received" stays the net in hand.
  const prev = r?.outstanding_paise ?? 0;
  const current = prev - amount;
  const receiptNo = d.receipt_ref || "—";
  const method = METHOD_LABEL[d.method ?? ""] ?? d.method ?? "-";

  // Retailer receipt — cheque deposits get the dedicated cheque template.
  const to = e164India(r?.phone ?? null);
  if (!(await alreadySent(db, record.deposit_id, "receipt_sent"))) {
    if (!to) {
      await logEvent(record.deposit_id, "receipt_failed", { reason: "retailer has no usable phone number" });
    } else {
      const isCheque = d.method === "cheque";
      const sent = await sendTemplate(
        to,
        isCheque ? T_RECEIPT_CHEQUE : T_RECEIPT,
        isCheque
          ? {
              receipt_no: receiptNo,
              net_amount: inr(net),
              gross_amount: inr(amount),
              discount: inr(discount),
              salesperson,
              cheque_number: d.note || "—",
              current_outstanding: inr(current),
            }
          : {
              receipt_no: receiptNo,
              received_amount: inr(net),
              payment_method: method,
              gross_amount: inr(amount),
              discount: inr(discount),
              salesperson,
              current_outstanding: inr(current),
            },
      );
      if (sent.ok) {
        // The quoted figures ride the event — the durable record of what
        // the retailer was told.
        await logEvent(record.deposit_id, "receipt_sent", {
          wamid: sent.wamid,
          to,
          previous_outstanding_paise: prev,
          current_outstanding_paise: current,
        });
      } else {
        await logEvent(record.deposit_id, "receipt_failed", { reason: sent.reason, code: sent.code });
      }
    }
  }

  // Owner alert — goes to dad EVEN when the retailer has no phone. The
  // template has no method slot, so the method rides the salesperson param
  // ("Rajesh (Cash)") — owner-approved fold, 2026-09-03.
  const owner = e164India(OWNER_PHONE);
  if (owner && !(await alreadySent(db, record.deposit_id, "owner_alert_sent"))) {
    const sent = await sendTemplate(owner, T_OWNER_ALERT, {
      gross_amount: inr(amount),
      discount: inr(discount),
      net_amount: inr(net),
      salesperson: `${salesperson} (${method})`,
      retailer: r?.name ?? "Unknown retailer",
      receipt_no: receiptNo,
      current_outstanding: inr(current),
    });
    if (sent.ok) await logEvent(record.deposit_id, "owner_alert_sent", { wamid: sent.wamid, to: owner });
    else await logEvent(record.deposit_id, "owner_alert_failed", { reason: sent.reason, code: sent.code });
  }

  return Response.json({ ok: true });
}

// ---- trigger caller: action 'voided' --------------------------------------
async function handleDepositVoided(record: DepositEventRecord): Promise<Response> {
  const db = service();

  const { data: dep } = await db
    .from("deposits")
    .select("deposit_ref, retailer_id, amount_paise, discount_paise, receipt_ref, method, retailers(name, phone)")
    .eq("id", record.deposit_id)
    .maybeSingle();
  const row = dep as unknown as {
    deposit_ref: string;
    amount_paise: number;
    discount_paise: number;
    receipt_ref: string | null;
    method: string;
    retailers: { name: string; phone: string | null } | null;
  } | null;
  if (!row) return Response.json({ skipped: "deposit not found" });

  const voider = await actorName(db, record.actor_id);
  const gross = row.amount_paise;
  const net = gross - row.discount_paise;
  const receiptNo = row.receipt_ref || row.deposit_ref;
  const reason = record.details.reason ?? "no reason recorded";

  // Retailer cancellation — "please ignore the earlier payment message".
  const to = e164India(row.retailers?.phone ?? null);
  if (!(await alreadySent(db, record.deposit_id, "void_notice_sent"))) {
    if (!to) {
      await logEvent(record.deposit_id, "void_notice_failed", { reason: "retailer has no usable phone number" });
    } else {
      const sent = await sendTemplate(to, T_RECEIPT_VOIDED, {
        receipt_no: receiptNo,
        gross_amount: inr(gross),
      });
      if (sent.ok) await logEvent(record.deposit_id, "void_notice_sent", { wamid: sent.wamid, to });
      else await logEvent(record.deposit_id, "void_notice_failed", { reason: sent.reason, code: sent.code });
    }
  }

  // Owner void alert — who un-happened the money, and their exact words.
  const owner = e164India(OWNER_PHONE);
  if (owner && !(await alreadySent(db, record.deposit_id, "owner_void_alert_sent"))) {
    const sent = await sendTemplate(owner, T_OWNER_VOID, {
      receipt_no: receiptNo,
      app_receipt_number: row.deposit_ref,
      retailer: row.retailers?.name ?? "Unknown retailer",
      gross_amount: inr(gross),
      discount: inr(row.discount_paise),
      net_amount: inr(net),
      payment_method: METHOD_LABEL[row.method] ?? row.method,
      salesman: voider,
      cancelled_details: reason,
    });
    if (sent.ok) await logEvent(record.deposit_id, "owner_void_alert_sent", { wamid: sent.wamid, to: owner });
    else await logEvent(record.deposit_id, "owner_void_alert_failed", { reason: sent.reason, code: sent.code });
  }

  return Response.json({ ok: true });
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

// Every message kind logs `<kind>_sent` — statuses match wamid across all of
// them so the trail shows delivery for receipts, cancellations and alerts.
const SENT_ACTIONS = ["receipt_sent", "void_notice_sent", "owner_alert_sent", "owner_void_alert_sent"];

async function findSentByWamid(
  db: ReturnType<typeof service>,
  wamid: string,
): Promise<{ depositId: string; kind: string } | null> {
  const { data } = await db
    .from("deposit_events")
    .select("deposit_id, action")
    .in("action", SENT_ACTIONS)
    .eq("details->>wamid", wamid)
    .limit(1);
  if (!data?.[0]) return null;
  return { depositId: data[0].deposit_id, kind: (data[0].action as string).replace(/_sent$/, "") };
}

async function handleMetaEvents(payload: unknown): Promise<Response> {
  const db = service();
  const owner = e164India(OWNER_PHONE);
  const entries = (payload as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] }).entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const s of (value.statuses as MetaStatus[] | undefined) ?? []) {
        // read is BONUS signal (owner 2026-09-03): it only arrives when the
        // recipient has read receipts on — absence never means unread.
        if (s.status !== "delivered" && s.status !== "failed" && s.status !== "read") continue; // sent: noise
        const hit = await findSentByWamid(db, s.id);
        if (!hit) continue;
        const action = `${hit.kind}_${s.status}`;
        // Dedupe: Meta re-delivers webhooks; one trail line per outcome.
        const { data: dup } = await db
          .from("deposit_events")
          .select("id")
          .eq("deposit_id", hit.depositId)
          .eq("action", action)
          .eq("details->>wamid", s.id)
          .limit(1);
        if (dup && dup.length > 0) continue;
        await logEvent(hit.depositId, action, {
          wamid: s.id,
          ...(s.errors?.length ? { reason: s.errors[0].message ?? s.errors[0].title ?? `code ${s.errors[0].code}` } : {}),
        });
      }

      for (const m of (value.messages as MetaMessage[] | undefined) ?? []) {
        if (m.type !== "text" || !m.text?.body) continue;
        if (owner && m.from === owner) continue; // dad's texts are not tripwires
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

    // Our DB trigger — created and voided both message out (owner 2026-09-03).
    if (req.headers.get("x-trigger-secret") === TRIGGER_SECRET && TRIGGER_SECRET !== "") {
      const record = (payload as { record?: DepositEventRecord }).record;
      if (record?.action === "created") return await handleDepositCreated(record);
      if (record?.action === "voided") return await handleDepositVoided(record);
      return Response.json({ skipped: "not a messaging event" });
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
