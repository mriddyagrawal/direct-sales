// Edge Function `notify` — walking skeleton (docs/specs/notifications.md v1.2,
// build-order commit 1). Proves the pipeline end-to-end (webhook auth → fetch
// subscriptions → VAPID web-push → prune dead endpoints) with a hardcoded test
// card BEFORE any matrix code exists — front-loads the iOS-quirk risk. The
// matrix/copy/TTL/badge logic lands in the next commit; real webhook events
// are acknowledged and dropped until then.
//
// Secrets (Dashboard → Edge Functions → Secrets): WEBHOOK_SECRET,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY. SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY are runtime-injected.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:mridul289agrawal@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  badgeCount?: number;
}

// Send one push; prune the row on 404/410 (uninstalled PWA, rotated endpoint —
// the self-repair on the client mints replacements).
async function sendTo(
  supabase: ReturnType<typeof createClient>,
  sub: SubRow,
  payload: PushPayload,
  ttlSeconds: number,
): Promise<string> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: ttlSeconds },
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
  // MUST (spec §Pipeline): reject before parsing anything — without this,
  // anyone holding the function URL could spam fake cards to every device.
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Walking-skeleton test hook: {"test": true} pushes one card to EVERY
  // registered device. Fired manually (curl with the secret), never by a
  // webhook. Stays in place after the matrix lands — it's the pipeline's
  // health check.
  if (body.test === true) {
    const { data, error } = await supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const subs = (data ?? []) as unknown as SubRow[];
    const payload: PushPayload = {
      title: "🛒 Test — Ganpati Enterprises",
      body: "Push pipeline works end to end 🎉\nTap to open the app.",
      url: "/",
      tag: "pipeline-test",
    };
    const results: Record<string, string> = {};
    for (const sub of subs) results[sub.endpoint.slice(-12)] = await sendTo(supabase, sub, payload, 3600);
    return Response.json({ devices: subs.length, results });
  }

  // Real webhook events (order_events / deposit_events / retailers INSERTs)
  // are acknowledged and dropped until the matrix commit.
  return Response.json({ ignored: true });
});
