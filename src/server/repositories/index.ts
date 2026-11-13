import { createClient } from "@supabase/supabase-js";
import { supabaseConfigFromEnv } from "@/lib/supabase/config";
import type { ChatRepository } from "./chat-repository";
import { SupabaseChatRepository } from "./supabase-chat-repository";
import { accessTokenFromCookies } from "./supabase-session";

export {
  NotRoomCreatorError,
  NotSignedInError,
  RoomNotFoundError,
  type ChatRepository,
  type ListMessagesOptions,
} from "./chat-repository";

/**
 * The one place that picks the implementation. The client acts as whoever the request's session
 * cookie says, so row-level security sees the caller, and as a signed-out visitor when there is no
 * valid session. It uses the cookie's access token as it is (`accessToken`), so it has no auth client
 * that could refresh the session behind the proxy's back. It reads the request rather than
 * `next/headers`, which keeps route tests free of mocks and the prerendered page static.
 */
export function getChatRepository(request: Request): ChatRepository {
  const { url, anonKey } = supabaseConfigFromEnv();
  const cookieHeader = request.headers.get("cookie") ?? "";
  let token: Promise<string | null> | undefined;
  const client = createClient(url, anonKey, {
    // Read once per repository; null falls back to the anon key.
    accessToken: () => (token ??= accessTokenFromCookies(cookieHeader)),
  });
  // Reads the database rejects the caller's token for are retried signed out: reading needs no account.
  return new SupabaseChatRepository(client, createClient(url, anonKey, { auth: { persistSession: false } }));
}
