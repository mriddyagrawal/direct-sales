import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database.types";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

// Server Components / Route Handlers / Server Actions only. Always call
// supabase.auth.getUser() for auth decisions here — it revalidates against
// the Auth server. Never trust getSession() on the server for gating.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — the middleware refreshes the
            // session on every request, so a no-op here is safe.
          }
        },
      },
    },
  );
}
