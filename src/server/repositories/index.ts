import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { supabaseConfigFromEnv } from "@/lib/supabase/config";
import type { MessageSource } from "@/server/realtime/message-source";
import type { ChatRepository } from "./chat-repository";
import { PostgresMessageSource } from "./postgres-message-source";
import { SupabaseChatRepository } from "./supabase-chat-repository";

export { RoomNotFoundError, type ChatRepository, type ListMessagesOptions } from "./chat-repository";

/**
 * The one place that picks the implementation. The client acts as whoever the request's cookies
 * say, so row-level security sees the caller. It reads cookies from the request rather than from
 * `next/headers`, which keeps route tests free of mocks and the prerendered page static.
 */
export function getChatRepository(request: Request): ChatRepository {
  const { url, anonKey } = supabaseConfigFromEnv();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () =>
        parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
      // A route has no response to write cookies to. The client still refreshes an access token
      // within 90 s of expiry before each request, and a token refreshed here is lost, which can
      // sign the user out; only the session proxy (Task 5) refreshing first prevents that.
      setAll: () => {},
    },
  });
  return new SupabaseChatRepository(client);
}

function supabaseDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set. Copy .env.example to .env.");
  return url;
}

// Live messages still come from Postgres NOTIFY until Supabase Realtime replaces them.
// Each call opens its own LISTEN connection once started; getRealtimeHub keeps the one shared source.
export function createMessageSource(): MessageSource {
  return new PostgresMessageSource(supabaseDbUrl());
}
