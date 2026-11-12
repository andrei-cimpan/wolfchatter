import {
  combineChunks,
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
  stringFromBase64URL,
} from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigFromEnv } from "@/lib/supabase/config";

const BASE64_PREFIX = "base64-";

// A token this close to expiry is treated as gone. The proxy refreshes sessions well before this
// (Supabase refreshes within 90 s of expiry), so a route sees one only if the proxy did not run.
const EXPIRY_MARGIN_S = 10;

/** The session cookie's name, as supabase-js derives it from the project URL. */
export function sessionCookieName(): string {
  return `sb-${new URL(supabaseConfigFromEnv().url).hostname.split(".")[0]}-auth-token`;
}

function cookieValues(cookieHeader: string): Map<string, string> {
  return new Map(parseCookieHeader(cookieHeader).map(({ name, value }) => [name, value ?? ""]));
}

/**
 * The access token from a request's session cookie while it is still valid, otherwise null. It
 * never refreshes: a route has no response to save new cookies to, and a refresh there would rotate
 * the refresh token away and sign the user out. A missing, malformed or expired session reads as
 * signed out, so a stale cookie cannot turn a public read into an error.
 */
export async function accessTokenFromCookies(cookieHeader: string, nowMs = Date.now()): Promise<string | null> {
  const cookies = cookieValues(cookieHeader);
  const raw = await combineChunks(sessionCookieName(), (name) => cookies.get(name));
  if (!raw) return null;
  try {
    const json = raw.startsWith(BASE64_PREFIX) ? stringFromBase64URL(raw.slice(BASE64_PREFIX.length)) : raw;
    const session = JSON.parse(json) as Partial<Session>;
    if (typeof session.access_token !== "string" || typeof session.expires_at !== "number") return null;
    return session.expires_at - EXPIRY_MARGIN_S > nowMs / 1000 ? session.access_token : null;
  } catch {
    return null;
  }
}

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-"));
}

/**
 * Keeps the session fresh before a page or route sees it, as `@supabase/ssr` documents for Next:
 * the refreshed cookies go both to the request the route reads and to the response. A request with
 * no Supabase cookie makes no auth call, so signed-out readers cost nothing.
 */
export async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (!hasSessionCookie(request)) return response;

  const { url, anonKey } = supabaseConfigFromEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  // getClaims refreshes an expiring session and validates the token; its result is not needed here.
  await supabase.auth.getClaims();
  return response;
}

/**
 * Finishes Google sign-in: trades the code for a session and writes its cookies onto `response`.
 * Answers false when the code is missing, used or invalid, leaving the response without a session.
 */
export async function exchangeCodeForSession(request: Request, code: string, response: Response): Promise<boolean> {
  const { url, anonKey } = supabaseConfigFromEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () =>
        parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          response.headers.append("set-cookie", serializeCookieHeader(name, value, options));
        }
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return !error;
}

