import { createChunks, stringToBase64URL } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";
import { sessionCookieName } from "../supabase-session";

/**
 * The cookies a browser holds after signing in, as `@supabase/ssr` writes them: the session as
 * base64url JSON, split into chunks when long. For tests that call routes as a signed-in user.
 */
export function sessionCookies(session: Session): { name: string; value: string }[] {
  const value = `base64-${stringToBase64URL(JSON.stringify(session))}`;
  return createChunks(sessionCookieName(), value);
}

/** The same cookies as one `Cookie` request header. */
export async function sessionCookieHeader(session: Session): Promise<string> {
  return sessionCookies(session)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}
