import { createClient } from "@/lib/supabase/client";

// Client side of web push (docs/specs/notifications.md v1.2). The bell is the
// SOLE enable surface: the native permission dialog fires only from a
// deliberate tap (iOS gesture rule; the one-shot prompt can never burn
// accidentally). After the single grant, everything here is automatic —
// repairSubscription() runs silently on every app open and heals expired or
// rotated subscriptions without asking anything.

export type PushState = "unsupported" | "default" | "granted" | "denied";

export function pushState(): PushState {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    // iOS Safari outside an installed PWA lands here too — the bell hides.
    return "unsupported";
  }
  return Notification.permission as PushState;
}

// The VAPID public key is public by definition (it ships to every browser);
// only its PRIVATE twin (Edge Function secret) can sign sends.
function applicationServerKey(): Uint8Array {
  const b64 = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : "Desktop";
  const standalone = window.matchMedia("(display-mode: standalone)").matches ? " PWA" : "";
  return `${os}${standalone}`;
}

// Persist this device's subscription under the signed-in user (RLS: own rows
// only). Upsert on the unique endpoint; a shared device whose subscription
// still belongs to ANOTHER user can't be updated under RLS — unsubscribe at
// the browser level (no RLS there) and mint a fresh endpoint instead; the
// orphaned row prunes itself on its first failed send (404/410).
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const json = sub.toJSON();
  const row = {
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    device_label: deviceLabel(),
    last_seen_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  if (error) {
    await sub.unsubscribe();
    const reg = await navigator.serviceWorker.ready;
    const fresh = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey() as BufferSource,
    });
    const freshJson = fresh.toJSON();
    const { error: err2 } = await supabase.from("push_subscriptions").upsert(
      {
        ...row,
        endpoint: fresh.endpoint,
        p256dh: freshJson.keys?.p256dh ?? "",
        auth: freshJson.keys?.auth ?? "",
      },
      { onConflict: "endpoint" },
    );
    if (err2) throw new Error(err2.message);
  }
}

// The bell's tap handler — MUST be called from a user gesture (iOS).
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission as PushState;
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey() as BufferSource,
    }));
  await saveSubscription(sub);
  return "granted";
}

// Silent self-heal on every app open (no gesture needed once granted): re-mint
// a missing/rotated subscription and refresh last_seen_at. Never throws — a
// failed repair just tries again next open.
export async function repairSubscription(): Promise<void> {
  try {
    if (pushState() !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey() as BufferSource,
      }));
    await saveSubscription(sub);
  } catch {
    // Non-fatal by design.
  }
}

// R6 clear-on-open: close every shown notification on this device and reset
// the badge; the badge recount rides the next push (server-computed) or the
// role's own screens. Page-context APIs only — no SW round-trip needed.
export async function clearShownNotifications(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const shown = await reg.getNotifications();
    for (const n of shown) n.close();
    if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
  } catch {
    // Badging/notifications unsupported — nothing to clear.
  }
}
