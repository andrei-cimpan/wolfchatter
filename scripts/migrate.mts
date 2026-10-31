import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "db", "migrations");
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const CONNECT_ATTEMPTS = 20;
const CONNECT_DELAY_MS = 500;
// Arbitrary constant shared by every runner; serializes instances migrating at startup.
const MIGRATION_LOCK_KEY = 7_420_391;

// Zero-padded names make lexical order the apply order.
export function pendingMigrations(files: string[], applied: Set<string>): string[] {
  const invalid = files.filter((f) => f.endsWith(".sql") && !MIGRATION_FILE.test(f));
  if (invalid.length > 0) {
    throw new Error(`Migration files must be named NNNN_name.sql: ${invalid.join(", ")}`);
  }
  return files
    .filter((f) => MIGRATION_FILE.test(f) && !applied.has(f))
    .sort();
}

// `docker compose up -d` returns before Postgres accepts connections.
async function connectWithRetry(connectionString: string): Promise<pg.Client> {
  for (let attempt = 1; ; attempt++) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= CONNECT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, CONNECT_DELAY_MS));
    }
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }

  const client = await connectWithRetry(connectionString);
  try {
    // Taken before reading schema_migrations so a waiting runner sees what the first one applied.
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const pending = pendingMigrations(
      await readdir(MIGRATIONS_DIR),
      new Set(rows.map((r) => r.name)),
    );

    if (pending.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    for (const name of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      // Each file and its bookkeeping row commit together, so a failure leaves no partial state.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${name} failed`, { cause: error });
      }
    }
  } finally {
    // Ending the session also releases the lock; unlocking first just makes that explicit.
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
