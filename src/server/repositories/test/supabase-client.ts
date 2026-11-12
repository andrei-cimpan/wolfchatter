import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfigFromEnv } from "@/lib/supabase/config";

/** A client signed in as nobody, as a visitor's requests are; `url` lets a test point it elsewhere. */
export function anonClient(url = supabaseConfigFromEnv().url): SupabaseClient {
  return createClient(url, supabaseConfigFromEnv().anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
