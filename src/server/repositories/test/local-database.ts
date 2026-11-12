import pg from "pg";

// The local Supabase stack listens on the loopback address. Tests and e2e empty the database they
// connect to, so anything else, such as a .env pointing at the hosted project, is refused.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function assertLocalDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_DB_URL is not set or not a URL. Copy it from .env.example to .env.");
  }
  // pg connects to a `host` (or `hostaddr`) given in the query in place of the URL's own host.
  const hosts = [parsed.hostname, ...parsed.searchParams.getAll("host"), ...parsed.searchParams.getAll("hostaddr")];
  const remote = hosts.find((host) => !LOCAL_HOSTS.has(host));
  if (remote !== undefined) {
    throw new Error(`Tests empty their database, so they only run against the local stack, not ${remote}.`);
  }
}

/**
 * `assertLocalDatabase`, then a look inside: another local Postgres, such as v1's on port 5432,
 * passes the host check, but only the Supabase stack's database has its `auth` schema and Realtime
 * publication. Run before anything is emptied.
 */
export async function assertLocalSupabaseDatabase(url: string): Promise<void> {
  assertLocalDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ is_stack: boolean }>(
      `select to_regnamespace('auth') is not null
          and exists (select 1 from pg_publication where pubname = 'supabase_realtime') as is_stack`,
    );
    if (!rows[0]?.is_stack) {
      throw new Error(`${new URL(url).pathname.slice(1)} is not the local Supabase database, so tests will not empty it.`);
    }
  } finally {
    await client.end();
  }
}
