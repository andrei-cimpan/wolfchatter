import type { NextRequest } from "next/server";
import { refreshSession } from "@/server/repositories/supabase-session";

/**
 * Refreshes the Supabase session before pages and API reads see it, so routes can use the cookie's
 * access token as it is and never refresh it themselves. Without a session cookie it does nothing.
 */
export function proxy(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  matcher: [
    // Pages and /auth/callback (whose PKCE verifier cookie is read as it was set), but not Next's
    // own assets, the favicon or images.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    // API reads. A request with a body is left out: when the browser aborts one, Next's handling of
    // the body for a proxy throws an uncaught "aborted" error. Posts come from the open page, whose
    // Supabase client keeps the session cookies fresh itself.
    { source: "/api/:path*", missing: [{ type: "header", key: "content-type" }] },
  ],
};
