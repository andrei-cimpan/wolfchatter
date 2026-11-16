import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfigFromEnv } from "./config";

let client: SupabaseClient | undefined;

/**
 * The browser's one Supabase client, made on first use. One client means one Realtime socket for
 * the tab, however many rooms it opens in turn. The UI only subscribes with it: reads and writes
 * go through the API routes and `ChatRepository`.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = supabaseConfigFromEnv();
    // A hidden tab keeps its room channel (for notifications), and browsers throttle a background
    // tab's timers enough to miss heartbeats; a worker's timers are not throttled. The worker's
    // script is inlined by realtime-js, so nothing is fetched from elsewhere.
    client = createBrowserClient(url, anonKey, { realtime: { worker: true } });
  }
  return client;
}
