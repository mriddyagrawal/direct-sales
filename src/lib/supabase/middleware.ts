import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database.types";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

const ROLE_HOME: Record<string, string> = {
  salesman: "/",
  accountant: "/dashboard",
  admin: "/dashboard",
  godown: "/godown",
};

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // A redirect is a *new* NextResponse — it doesn't inherit whatever the
  // cookie adapter's setAll() already wrote onto supabaseResponse (a
  // refreshed session, or signOut()'s cookie-clears). Every redirect must
  // carry those over explicitly, or the session mutation is silently lost:
  // a signOut() redirect that drops its own clears re-authenticates the
  // very next request (infinite loop on the deactivated path), and a
  // token-refresh redirect that drops the new tokens logs the user out.
  function redirectWithCookies(url: URL) {
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  }

  // getUser() revalidates against the Auth server — the only safe way to
  // gate on the server. getSession() only reads the (possibly stale) cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginRoute = pathname === "/login";

  if (!user) {
    if (isLoginRoute) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return redirectWithCookies(url);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.active ? profile.role : null;

  if (!role) {
    // Deactivated, or no profile row at all — fail closed: sign out, never
    // show an app shell.
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("reason", "deactivated");
    return redirectWithCookies(url);
  }

  const home = ROLE_HOME[role] ?? "/login";

  if (isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    url.search = "";
    return redirectWithCookies(url);
  }

  const isDashboardRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isGodownRoute = pathname === "/godown" || pathname.startsWith("/godown/");
  const isSalesmanHomeRoute = pathname === "/";
  // Godown is confined to /godown (its whole app); everyone else is fenced
  // OUT of /godown. Salesman/staff fencing is unchanged beyond that.
  const wrongTerritory =
    (role === "salesman" && (isDashboardRoute || isGodownRoute)) ||
    (role === "godown" && !isGodownRoute) ||
    (role !== "salesman" && role !== "godown" && (isSalesmanHomeRoute || isGodownRoute));

  if (wrongTerritory) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    return redirectWithCookies(url);
  }

  return supabaseResponse;
}
