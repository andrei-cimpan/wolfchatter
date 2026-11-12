import { randomUUID } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { supabaseConfigFromEnv } from "@/lib/supabase/config";
import { assertLocalSupabaseDatabase } from "./local-database";
import { anonClient } from "./supabase-client";

/** Test users get this email domain, so setup can delete them between tests. */
export const TEST_EMAIL_DOMAIN = "example.test";

export type TestName = { full_name?: string; given_name?: string; family_name?: string; name?: string };

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (test setup only). See .env.example.");
  return key;
}

/**
 * Creates a signed-in user, as Google sign-in would, without Google: a password user made through
 * the admin API, whose identity then gets the name fields Google sends. Returns a client that acts
 * as that user, and the session behind it.
 */
export async function createTestUser(
  name: TestName = { full_name: "Ana Popescu" },
): Promise<{ userId: string; client: SupabaseClient; session: Session }> {
  const admin = createClient(supabaseConfigFromEnv().url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `user-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const userId = created.data.user.id;

  // The admin API has no way to write identity_data, so the name goes in directly.
  const dbUrl = process.env.SUPABASE_DB_URL ?? "";
  await assertLocalSupabaseDatabase(dbUrl);
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  try {
    await db.query("update auth.identities set identity_data = identity_data || $2::jsonb where user_id = $1", [
      userId,
      JSON.stringify(name),
    ]);
  } finally {
    await db.end();
  }

  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { userId, client, session: signedIn.data.session };
}
