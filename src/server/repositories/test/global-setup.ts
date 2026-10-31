import pg from "pg";
import { migrate } from "../../../../scripts/migrate.mts";

// Losing a CREATE DATABASE race reports 42P04 or, when both commits overlap, a 23505 unique
// violation on pg_database's name index. Either way the database now exists.
const DATABASE_ALREADY_EXISTS = new Set(["42P04", "23505"]);

// Tests truncate tables, so they must never point at a database someone cares about.
export function testDatabaseName(testUrl: string | undefined, devUrl: string | undefined): string {
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set. Copy it from .env.example to .env.");
  if (testUrl === devUrl) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL.");
  const name = new URL(testUrl).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`TEST_DATABASE_URL must name a database ending in _test, got "${name}".`);
  }
  return name;
}

async function createDatabaseIfMissing(testUrl: string, name: string): Promise<void> {
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [name]);
    // CREATE DATABASE takes no parameters; the name was checked against [a-z0-9_] above.
    if (rowCount === 0) await admin.query(`create database "${name}"`);
  } catch (error) {
    // Another test run created it between the check and the create.
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (typeof code !== "string" || !DATABASE_ALREADY_EXISTS.has(code)) throw error;
  } finally {
    await admin.end();
  }
}

async function prepareTestDatabase(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  const name = testDatabaseName(testUrl, process.env.APP_DATABASE_URL);
  await createDatabaseIfMissing(testUrl!, name);
  await migrate(testUrl!, () => {});
}

export default async function setup(): Promise<void> {
  try {
    await prepareTestDatabase();
  } catch (error) {
    // Vitest 5 loses global setup errors while formatting their stack trace and prints only
    // "No test files found", so say what went wrong before failing.
    console.error(`\nTest database setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}
