import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database.types";

const ROLE_HOME: Record<string, string> = {
  salesman: "/",
  accountant: "/dashboard",
  admin: "/dashboard",
};

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
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
    return NextResponse.redirect(url);
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
    return NextResponse.redirect(url);
  }

  const home = ROLE_HOME[role] ?? "/login";

  if (isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isDashboardRoute = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isSalesmanHomeRoute = pathname === "/";
  const wrongTerritory =
    (role === "salesman" && isDashboardRoute) || (role !== "salesman" && isSalesmanHomeRoute);

  if (wrongTerritory) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
