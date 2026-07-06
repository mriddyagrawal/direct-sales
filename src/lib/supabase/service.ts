import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// SERVER-ONLY, privileged client — uses SUPABASE_SERVICE_ROLE_KEY, which
// bypasses RLS and every function grant. The `server-only` import makes any
// accidental import from a Client Component a build-time error, not a
// runtime leak.
//
// Narrow, deliberate use case: email_for_username() has NO anon/
// authenticated grant (flag 21 — an anon-callable version let anyone with
// the public anon key harvest emails by guessing usernames, bypassing the
// app's Server Action entirely). Only this service-role client, called
// from within a Server Action and never exposed to the browser, can call
// it now. Don't reach for this client for anything else — regular request-
// scoped work still goes through lib/supabase/server.ts (RLS-scoped,
// session-aware) so mistakes there fail closed instead of bypassing RLS.
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
