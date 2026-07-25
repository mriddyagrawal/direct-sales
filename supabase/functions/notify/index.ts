// Edge Function `notify` — THE MATRIX (docs/specs/notifications.md v1.2).
// Webhook events (order_events / deposit_events / retailers INSERTs, posted by
// public.notify_webhook() with the shared-secret header) become role-scoped
// push cards per the owner-approved matrix. Ground rules enforced here:
//   R1 never notify the actor · R2 admin cancellations are silent (deposit
//   voids exempt) · R5 a salesman only ever hears about his OWN orders and
//   deposits · storm guard: retailer trigger already gated verified=false.
// TTL: job cards (godown pick / godown dispatch / accountant ready-to-bill)
// 4 h, everything else 24 h. tag = entity id (Android collapses to one
// evolving card per order; sw.js sets renotify so every replacement rings, R3).
// Badge = the role's open-jobs count (admin pending approvals · accountant
// ready-to-bill · godown picks+dispatches · salesman none).
//
// Secrets: WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (dashboard).
import webpush from "npm:web-push@3.6.7";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:mridul289agrawal@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const TTL_JOB = 4 * 3600;
const TTL_NEWS = 24 * 3600;

type Role = "admin" | "accountant" | "salesman" | "godown";

interface Card {
  title: string;
  body: string; // line 1 = collapsed triage; \n-joined lines = second page
  url: string;
  tag?: string;
  ttl: number;
  withBadge?: boolean; // recompute this role's open-jobs badge count
}

interface Profile {
  id: string;
  role: Role;
  full_name: string;
}

interface OrderItemRow {
  product_name: string;
  qty: number;
  picked_qty: number | null;
  position: number;
  stock_at_order: number | null;
}

interface OrderRow {
  id: string;
  order_ref: string;
  status: string;
  total_paise: number;
  salesman_id: string;
  admin_comment: string | null;
  tally_bill_no: string | null;
  dispatch_note: string | null;
  approved_at: string | null;
  picked_at: string | null;
  processed_at: string | null;
  dispatched_at: string | null;
  retailers: { name: string } | null;
  brands: { name: string } | null;
  order_items: OrderItemRow[];
}

// Money: en-IN from paise, everywhere (house rule). ₹11,425 / ₹1,425.50.
function rupees(paise: number): string {
  const r = paise / 100;
  return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Second-page item lines: "2× WM 7kg", ⚠️ on lines already out of stock at
// order time (approve knowing what will backorder). Cap 5 then "+N more";
// expanded always ends with the ref.
function itemLines(items: OrderItemRow[], opts?: { flags?: boolean; picks?: boolean }): string[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const lines = sorted.slice(0, 5).map((it) => {
    if (opts?.picks) {
      const picked = it.picked_qty ?? 0;
      const mark = picked >= it.qty ? "✓" : picked === 0 ? "→ backorder" : `of ${it.qty}`;
      return `${picked}/${it.qty} ${it.product_name} ${mark}`.trim();
    }
    const flag = opts?.flags && (it.stock_at_order ?? 0) === 0 ? " ⚠️" : "";
    return `${it.qty}× ${it.product_name}${flag}`;
  });
  if (sorted.length > 5) lines.push(`+${sorted.length - 5} more`);
  return lines;
}

function card(role: Role, c: Omit<Card, "url"> & { url: string }): [Role, Card] {
  return [role, c];
}

// Per-event cards, keyed by recipient role. The salesman card is delivered
// ONLY to the order's own salesman (R5) — see resolveRecipients.
function orderCards(action: string, o: OrderRow, actorName: string, details: Record<string, unknown>): Map<Role, Card> {
  const retailer = o.retailers?.name ?? "Unknown retailer";
  const brand = o.brands?.name ?? "";
  const n = o.order_items.length;
  const staffUrl = `/dashboard/orders/${o.id}`;
  const ownUrl = `/orders/${o.id}`;
  const cards = new Map<Role, Card>();
  const put = (...entries: [Role, Card][]) => entries.forEach(([r, c]) => cards.set(r, c));

  switch (action) {
    case "submitted": {
      const punched = details.punched === true ? " · punched backorder" : "";
      const body = [`${rupees(o.total_paise)} · ${n} items · ${brand} · by ${actorName}${punched}`, ...itemLines(o.order_items, { flags: true }), o.order_ref].join("\n");
      const c: Card = { title: `🛒 New order — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS, withBadge: true };
      put(card("admin", c), card("accountant", { ...c }));
      break;
    }
    case "items_changed":
    case "edited_after_lock": {
      const body = [`${o.order_ref} · now ${n} items · ${rupees(o.total_paise)} · by ${actorName}`, ...itemLines(o.order_items), o.order_ref].join("\n");
      const c: Card = { title: `✏️ Order edited — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS, withBadge: true };
      put(card("admin", c), card("accountant", { ...c }), card("salesman", { ...c, url: ownUrl }));
      break;
    }
    case "commented": {
      const note = (details.comment as string) ?? o.admin_comment ?? "";
      const body = [`${o.order_ref} · note on the second page`, note, o.order_ref].join("\n");
      put(
        card("salesman", { title: `💬 Note from the office — ${retailer}`, body, url: ownUrl, tag: o.id, ttl: TTL_NEWS }),
        card("accountant", { title: `💬 Note from the office — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS }),
      );
      break;
    }
    case "approved": {
      const newsBody = [`${o.order_ref} · ${rupees(o.total_paise)} · by ${actorName}`, ...itemLines(o.order_items), o.order_ref].join("\n");
      const pickBody = [`${n} items · ${o.order_ref} · ${retailer}`, ...itemLines(o.order_items), o.order_ref].join("\n");
      put(
        card("salesman", { title: `✅ Order approved — ${retailer}`, body: newsBody, url: ownUrl, tag: o.id, ttl: TTL_NEWS }),
        card("accountant", { title: `✅ Order approved — ${retailer}`, body: newsBody, url: staffUrl, tag: o.id, ttl: TTL_NEWS }),
        card("godown", { title: `📦 New pick — ${brand}`, body: pickBody, url: `/godown/${o.id}`, tag: o.id, ttl: TTL_JOB, withBadge: true }),
      );
      break;
    }
    case "backordered": {
      const body = [`${o.order_ref} · by ${actorName}`, ...itemLines(o.order_items, { picks: true }), o.order_ref].join("\n");
      const c: Card = { title: `⚠️ Backordered — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS };
      put(card("admin", c), card("accountant", { ...c }), card("salesman", { ...c, url: ownUrl }));
      break;
    }
    case "picked": {
      const total = o.order_items.reduce((s, it) => s + it.qty, 0);
      const picked = o.order_items.reduce((s, it) => s + (it.picked_qty ?? 0), 0);
      const short = total - picked;
      const l1 = short > 0 ? `${picked}/${total} items · ${short} short → backorder` : `${picked}/${total} items ✓`;
      const body = [l1, ...itemLines(o.order_items, { picks: true }), o.order_ref].join("\n");
      put(
        card("admin", { title: `📦 Picked — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS }),
        card("accountant", { title: `🧾 Ready to bill — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_JOB, withBadge: true }),
      );
      break;
    }
    case "billed": {
      const bill = o.tally_bill_no ?? "?";
      const body = [`Bill #${bill} · ${rupees(o.total_paise)} · by ${actorName}`, ...itemLines(o.order_items), o.order_ref].join("\n");
      put(
        card("admin", { title: `🧾 Billed — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS }),
        card("salesman", { title: `🧾 Bill ready — ${retailer}`, body: [`${o.order_ref} · Bill #${bill}`, o.order_ref].join("\n"), url: ownUrl, tag: o.id, ttl: TTL_NEWS }),
        card("godown", { title: `🚚 Ready to dispatch — ${retailer}`, body: [`${o.order_ref} · ${n} items · billed ✓`, ...itemLines(o.order_items), `Bill #${bill}`, o.order_ref].join("\n"), url: `/godown/orders/${o.id}`, tag: o.id, ttl: TTL_JOB, withBadge: true }),
      );
      break;
    }
    case "dispatched": {
      const note = o.dispatch_note ? [o.dispatch_note] : [];
      const body = [`${o.order_ref} · on its way`, ...note, o.order_ref].join("\n");
      const c: Card = { title: `🚚 Dispatched — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS };
      put(card("admin", c), card("accountant", { ...c }), card("salesman", { ...c, url: ownUrl }));
      break;
    }
    case "cancelled": {
      const reason = (details.reason as string) ?? "";
      const body = [`${o.order_ref} · by ${actorName}${reason ? ` · "${reason}"` : ""}`, `${n} items`, o.order_ref].join("\n");
      const c: Card = { title: `❌ Cancelled — ${retailer}`, body, url: staffUrl, tag: o.id, ttl: TTL_NEWS, withBadge: true };
      put(card("admin", c), card("accountant", { ...c }), card("salesman", { ...c, url: ownUrl }));
      // Godown only if a pick or dispatch was still pending (matrix note).
      const pickPending = o.approved_at !== null && o.picked_at === null;
      const dispatchPending = o.processed_at !== null && o.dispatched_at === null;
      if (pickPending || dispatchPending) {
        put(card("godown", { ...c, url: `/godown/orders/${o.id}`, withBadge: true }));
      }
      break;
    }
    // stepped_back: admin tool — silent (spec non-event).
  }
  return cards;
}

interface DepositRow {
  id: string;
  deposit_ref: string;
  amount_paise: number;
  method: string;
  note: string | null;
  void_reason: string | null;
  salesman_id: string;
  retailers: { name: string } | null;
  profiles: { full_name: string } | null;
}

function depositCards(action: string, d: DepositRow, actorName: string): Map<Role, Card> {
  const retailer = d.retailers?.name ?? "Unknown retailer";
  const method = d.method.charAt(0).toUpperCase() + d.method.slice(1);
  const cards = new Map<Role, Card>();
  if (action === "created") {
    const body = [`${method} · by ${d.profiles?.full_name ?? actorName}`, ...(d.note ? [d.note] : []), d.deposit_ref].join("\n");
    const c: Card = { title: `₹ Deposit ${rupees(d.amount_paise)} — ${retailer}`, body, url: "/dashboard/deposits", tag: d.id, ttl: TTL_NEWS };
    cards.set("admin", c);
    cards.set("accountant", { ...c });
  } else if (action === "voided") {
    const body = [`${rupees(d.amount_paise)} ${d.method} · by ${actorName}${d.void_reason ? ` · "${d.void_reason}"` : ""}`, d.deposit_ref].join("\n");
    const c: Card = { title: `₹ Deposit voided — ${retailer}`, body, url: "/dashboard/deposits", tag: d.id, ttl: TTL_NEWS };
    cards.set("admin", c);
    cards.set("accountant", { ...c }); // owner ruling 2026-07-25: she reconciles the drawer
    cards.set("salesman", { ...c, url: "/deposits" }); // R2 exemption: admin voids DO notify
  }
  return cards;
}

// Role's open-jobs badge count, computed at send time; recomputed client-side
// on open (R6). Salesman has no queue — no badge.
async function badgeCount(supabase: SupabaseClient, role: Role): Promise<number | undefined> {
  const count = async (statuses: string[]) => {
    const { count: c } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", statuses);
    return c ?? 0;
  };
  if (role === "admin") return await count(["pending_approval"]);
  if (role === "accountant") return await count(["ready_to_bill"]);
  if (role === "godown") return await count(["approved", "billed"]);
  return undefined;
}

async function sendTo(
  supabase: SupabaseClient,
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: Record<string, unknown>,
  ttl: number,
): Promise<string> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: ttl },
    );
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    if (status === 404 || status === 410) {
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      return "pruned";
    }
    return `error ${status}`;
  }
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // Pipeline health check (manual, curl-only) — predates the matrix, stays.
    if (body.test === true) {
      const { data } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
      const results: Record<string, string> = {};
      for (const sub of data ?? []) {
        results[sub.endpoint.slice(-12)] = await sendTo(
          supabase,
          sub,
          { title: "🛒 Test — Ganpati Enterprises", body: "Push pipeline works end to end 🎉", url: "/", tag: "pipeline-test" },
          3600,
        );
      }
      return Response.json({ devices: (data ?? []).length, results });
    }

    const table = body.table as string;
    const record = (body.record ?? {}) as Record<string, unknown>;

    // ---- Build the role→card map + identify actor and the R5 salesman ------
    let cards = new Map<Role, Card>();
    let actorId: string | null = null;
    let ownSalesmanId: string | null = null;

    if (table === "order_events") {
      const action = record.action as string;
      actorId = (record.actor_id as string) ?? null;
      const { data: o } = await supabase
        .from("orders")
        .select(
          "id, order_ref, status, total_paise, salesman_id, admin_comment, tally_bill_no, dispatch_note, approved_at, picked_at, processed_at, dispatched_at, retailers(name), brands(name), order_items(product_name, qty, picked_qty, position, stock_at_order)",
        )
        .eq("id", record.order_id as string)
        .maybeSingle();
      if (!o) return Response.json({ ignored: "order gone" });
      const order = o as unknown as OrderRow;
      ownSalesmanId = order.salesman_id;

      let actorName = "the office";
      let actorRole: Role | null = null;
      if (actorId) {
        const { data: actor } = await supabase.from("profiles").select("full_name, role").eq("id", actorId).maybeSingle();
        actorName = actor?.full_name ?? actorName;
        actorRole = (actor?.role as Role) ?? null;
      }
      // R2: an ADMIN's cancellation is silent to everyone.
      if (action === "cancelled" && actorRole === "admin") return Response.json({ silent: "R2" });
      cards = orderCards(action, order, actorName, (record.details ?? {}) as Record<string, unknown>);
    } else if (table === "deposit_events") {
      const action = record.action as string;
      actorId = (record.actor_id as string) ?? null;
      const { data: d } = await supabase
        .from("deposits")
        .select("id, deposit_ref, amount_paise, method, note, void_reason, salesman_id, retailers(name), profiles!deposits_salesman_id_fkey(full_name)")
        .eq("id", record.deposit_id as string)
        .maybeSingle();
      if (!d) return Response.json({ ignored: "deposit gone" });
      const dep = d as unknown as DepositRow;
      ownSalesmanId = dep.salesman_id;
      let actorName = "the office";
      if (actorId) {
        const { data: actor } = await supabase.from("profiles").select("full_name").eq("id", actorId).maybeSingle();
        actorName = actor?.full_name ?? actorName;
      }
      cards = depositCards(action, dep, actorName);
    } else if (table === "retailers") {
      // Trigger already gates verified=false (bulk-import storm guard).
      actorId = (record.created_by as string) ?? null;
      let creator = "unknown";
      if (actorId) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", actorId).maybeSingle();
        creator = p?.full_name ?? creator;
      }
      const l1 = [record.area, `by ${creator}`].filter(Boolean).join(" · ");
      const c: Card = {
        title: `🏪 New retailer — ${record.name as string}`,
        body: [l1, ...(record.phone ? [String(record.phone)] : [])].join("\n"),
        url: "/dashboard/retailers",
        tag: record.id as string,
        ttl: TTL_NEWS,
      };
      cards.set("admin", c);
      cards.set("accountant", { ...c });
    } else {
      return Response.json({ ignored: true });
    }

    if (cards.size === 0) return Response.json({ silent: "non-event" });

    // ---- Resolve recipients: active profiles × cards, minus the actor (R1);
    // the salesman card goes ONLY to the entity's own salesman (R5). ---------
    const [{ data: profiles }, { data: subs }] = await Promise.all([
      supabase.from("profiles").select("id, role, full_name").eq("active", true),
      supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth"),
    ]);
    const badgeCache = new Map<Role, number | undefined>();
    const results: Record<string, string> = {};

    for (const p of (profiles ?? []) as Profile[]) {
      if (p.id === actorId) continue; // R1
      let c = cards.get(p.role);
      if (p.role === "salesman") {
        c = p.id === ownSalesmanId ? cards.get("salesman") : undefined; // R5
      }
      if (!c) continue;

      const payload: Record<string, unknown> = { title: c.title, body: c.body, url: c.url, tag: c.tag };
      if (c.withBadge) {
        if (!badgeCache.has(p.role)) badgeCache.set(p.role, await badgeCount(supabase, p.role));
        const count = badgeCache.get(p.role);
        if (typeof count === "number") payload.badgeCount = count;
      }
      for (const sub of (subs ?? []).filter((s) => s.user_id === p.id)) {
        results[`${p.full_name}:${sub.endpoint.slice(-8)}`] = await sendTo(supabase, sub, payload, c.ttl);
      }
    }
    return Response.json({ event: `${table}:${(record.action as string) ?? "insert"}`, sent: results });
  } catch (e) {
    // Never bounce the webhook — log and acknowledge; a lost push is
    // recoverable, a retry storm is not.
    console.error("notify error:", e);
    return Response.json({ error: String(e) });
  }
});
