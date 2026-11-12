import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-next-path";
import { exchangeCodeForSession } from "@/server/repositories/supabase-session";

/**
 * Where Google sign-in returns: trades `code` for a session cookie and sends the user back to
 * `next`, a path on this site. A cancelled sign-in, or a missing or bad code, goes back signed out;
 * the page then shows the sign-in prompt again rather than an error.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) return response;
  try {
    await exchangeCodeForSession(request, code, response);
  } catch (error) {
    // Auth unreachable: the user lands signed out and can try again.
    console.error("Sign-in callback failed", error);
  }
  return response;
}
