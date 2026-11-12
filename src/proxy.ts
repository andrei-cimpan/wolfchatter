import type { NextRequest } from "next/server";
import { refreshSession } from "@/server/repositories/supabase-session";

/**
 * Refreshes the Supabase session before pages and API routes see it, so routes can use the cookie's
 * access token as it is and never refresh it themselves. Without a session cookie it does nothing.
 */
export function proxy(request: NextRequest) {
  return refreshSession(request);
}

export const config = {
  // Everything but Next's own assets, the favicon and images; /auth/callback is included, so the
  // PKCE verifier cookie is read there as it was set.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
