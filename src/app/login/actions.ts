"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export interface LoginState {
  error: string | null;
}

/**
 * Where to send someone after a successful sign-in.
 *
 * SECURITY: this value arrives from the query string, so it is attacker-
 * controlled. An unvalidated redirect target is a textbook open redirect —
 * `/login?next=https://evil.example` would let a phishing mail send someone
 * through the real, correctly-certificated Ganpati login and out the other
 * side onto a lookalike, which is exactly the trust the attacker wants to
 * borrow. So this is an ALLOW-list of shapes, not a block-list of bad ones:
 *
 *   - must start with a single "/" — a same-origin absolute path;
 *   - "//host" is rejected: protocol-relative, resolves to another origin;
 *   - backslashes are rejected outright, because "/\evil.example" is treated
 *     as protocol-relative by several browsers and by WHATWG URL parsing;
 *   - "/login" is rejected so a stale ?next= cannot make a redirect loop.
 *
 * Anything failing those checks falls back to "/", where the proxy routes by
 * role. Never "fix up" a suspicious value — drop it.
 */
function safeNext(raw: FormData | string | null): string {
  const value = typeof raw === "string" ? raw : String((raw as FormData)?.get("next") ?? "");
  const next = value.trim();
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  if (next === "/login" || next.startsWith("/login/") || next.startsWith("/login?")) return "/";
  return next;
}

// Username -> email resolution happens entirely server-side via a
// service-role client (src/lib/supabase/service.ts). Supabase Auth only
// authenticates by email/phone (no native username login), so a
// public.email_for_username() RPC is unavoidable — but it has NO anon/
// authenticated grant (flag 21: an anon-callable version let anyone with
// the public anon key harvest emails by guessing usernames directly
// against the REST API, completely bypassing this Server Action — calling
// it from server-side code doesn't matter if the endpoint itself is
// anon-callable; the function's grant is what actually controls access).
// Only the service-role client — server-only, never in the browser — can
// call it now.
export async function signInWithUsername(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const serviceClient = createServiceClient();
  const { data: email, error: lookupError } = await serviceClient.rpc("email_for_username", {
    p_username: username,
  });

  // Same generic message whether the username doesn't exist, is
  // deactivated, or the password is wrong — never reveal which.
  if (lookupError || !email) {
    return { error: "Wrong username or password." };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    return { error: "Wrong username or password." };
  }

  // Back to wherever they were headed before the guard intercepted them, so a
  // shared link survives the login. With no (or an unsafe) `next`, "/" — and
  // role routing happens in the proxy from there, sending accountant/admin on
  // to /dashboard as needed.
  redirect(safeNext(formData));
}
