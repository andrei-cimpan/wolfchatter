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

// The runner wraps each file in one transaction. A file that commits on its own would leave
// half-applied changes with no schema_migrations row, and CONCURRENTLY cannot run in a transaction.
// Statement-level `begin;` only: PL/pgSQL `begin` blocks have no semicolon and stay allowed.
const SELF_MANAGED_TRANSACTION =
  /^\s*(?:begin(?:\s+(?:work|transaction))?|start\s+transaction|commit|end(?:\s+(?:work|transaction))|rollback)\s*;|\bconcurrently\b/im;

export function assertRunsInTransaction(name: string, sql: string): void {
  if (SELF_MANAGED_TRANSACTION.test(sql)) {
    throw new Error(
      `${name} manages its own transaction or uses CONCURRENTLY; the runner already wraps each file in one transaction.`,
    );
  }
}

// Socket errors while the server is not listening yet, and SQLSTATE 57P03 ("the database system
// is starting up"). Anything else, such as a wrong password or unknown database, will not fix itself.
const TRANSIENT_CONNECT_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "57P03"]);

export function isTransientConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && TRANSIENT_CONNECT_CODES.has(code)) return true;
  // pg reports a server that closes the socket during startup with this message and no code.
  return error.message.startsWith("Connection terminated unexpectedly");
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
      if (attempt >= CONNECT_ATTEMPTS || !isTransientConnectError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, CONNECT_DELAY_MS));
    }
  }
}

// Exported so the test setup migrates its own database with exactly the same code path.
export async function migrate(
  connectionString: string,
  log: (line: string) => void = console.log,
): Promise<void> {
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
      log("No pending migrations.");
      return;
    }

    // Read and check every file first, so a bad one stops the run before anything is applied.
    const migrations = await Promise.all(
      pending.map(async (name) => ({ name, sql: await readFile(join(MIGRATIONS_DIR, name), "utf8") })),
    );
    for (const { name, sql } of migrations) assertRunsInTransaction(name, sql);

    for (const { name, sql } of migrations) {
      // Each file and its bookkeeping row commit together, so a failure leaves no partial state.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
        log(`Applied ${name}`);
      } catch (error) {
        // If the connection is gone, rollback throws too; keep the original error instead.
        await client.query("rollback").catch(() => {});
        throw new Error(`Migration ${name} failed`, { cause: error });
      }
    }
  } finally {
    // Ending the session also releases the lock; unlocking first just makes that explicit.
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  await migrate(connectionString);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
