"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export interface LoginState {
  error: string | null;
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

  // Role routing happens in the proxy (middleware) based on the caller's
  // profile — redirecting to "/" lets it send accountant/admin to
  // /dashboard as needed.
  redirect("/");
}
