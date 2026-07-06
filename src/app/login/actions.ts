"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  error: string | null;
}

// Username -> email resolution happens entirely here, server-side.
// Supabase Auth only authenticates by email/phone (no native username
// login), so a public.email_for_username() RPC (security definer, callable
// by anon — see decisions.md D9) is unavoidable. Calling it from a Server
// Action rather than the browser's Supabase client means the looked-up
// email is used internally and never serialized back to client-visible
// network traffic — closing the "script requests to harvest emails via a
// username-lookup endpoint" risk a client-side call would carry.
export async function signInWithUsername(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  const supabase = await createClient();

  const { data: email, error: lookupError } = await supabase.rpc("email_for_username", {
    p_username: username,
  });

  // Same generic message whether the username doesn't exist, is
  // deactivated, or the password is wrong — never reveal which.
  if (lookupError || !email) {
    return { error: "Wrong username or password." };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError) {
    return { error: "Wrong username or password." };
  }

  // Role routing happens in the proxy (middleware) based on the caller's
  // profile — redirecting to "/" lets it send accountant/admin to
  // /dashboard as needed.
  redirect("/");
}
