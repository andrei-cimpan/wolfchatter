import { savePendingDraft, type DraftPosition } from "@/lib/pending-draft";
import { getBrowserSupabase } from "./browser-client";

/** Where Google sends the user back: /auth/callback, which then returns to this page and room. */
export function signInRedirectTo(location: Pick<Location, "origin" | "pathname" | "search">): string {
  return `${location.origin}/auth/callback?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/**
 * Leaves for Google's sign-in page. A draft pin has no URL, so its position is kept in this tab's
 * sessionStorage and restored on return; there is no typed text to lose, since the form shows only
 * once signed in.
 */
export async function signInWithGoogle(options: { draft?: DraftPosition } = {}): Promise<void> {
  if (options.draft) savePendingDraft(window.sessionStorage, options.draft);
  const { error } = await getBrowserSupabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: signInRedirectTo(window.location) },
  });
  if (error) throw error;
}

/** Signs out in this browser only; other devices stay signed in. */
export async function signOut(): Promise<void> {
  const { error } = await getBrowserSupabase().auth.signOut({ scope: "local" });
  if (error) throw error;
}
