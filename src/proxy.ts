import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, images, and other static assets
     * - sw.js + manifest.webmanifest — Chrome's PWA installability checker
     *   fetches these WITHOUT the app's session cookies; routing them through
     *   the auth proxy 307s them to /login and the install prompt never
     *   appears. Both are public metadata (branding + a passthrough script) —
     *   nothing behind auth.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
