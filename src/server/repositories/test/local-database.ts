// The local Supabase stack listens on the loopback address. Tests and e2e empty the database they
// connect to, so anything else, such as a .env pointing at the hosted project, is refused.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function assertLocalDatabase(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("SUPABASE_DB_URL is not set or not a URL. Copy it from .env.example to .env.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Tests empty their database, so they only run against the local stack, not ${host}.`);
  }
}
