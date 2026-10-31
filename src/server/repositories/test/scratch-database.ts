import pg from "pg";

// Losing a CREATE DATABASE race reports 42P04 or, when both commits overlap, a 23505 unique
// violation on pg_database's name index. Either way the database now exists.
const DATABASE_ALREADY_EXISTS = new Set(["42P04", "23505"]);

/**
 * Test suites empty their database, so it must never be one someone cares about: the URL must
 * be set, differ from the app's DATABASE_URL, and name a database ending in `_<suffix>`.
 */
export function scratchDatabaseName(
  varName: string,
  url: string | undefined,
  devUrl: string | undefined,
  suffix: string,
): string {
  if (!url) throw new Error(`${varName} is not set. Copy it from .env.example to .env.`);
  if (url === devUrl) throw new Error(`${varName} must differ from DATABASE_URL.`);
  const name = new URL(url).pathname.slice(1);
  if (!new RegExp(`^[a-z0-9_]+_${suffix}$`).test(name)) {
    throw new Error(`${varName} must name a database ending in _${suffix}, got "${name}".`);
  }
  return name;
}

export async function createDatabaseIfMissing(url: string, name: string): Promise<void> {
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [name]);
    // CREATE DATABASE takes no parameters; scratchDatabaseName checked the name against [a-z0-9_].
    if (rowCount === 0) await admin.query(`create database "${name}"`);
  } catch (error) {
    // Another test run created it between the check and the create.
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (typeof code !== "string" || !DATABASE_ALREADY_EXISTS.has(code)) throw error;
  } finally {
    await admin.end();
  }
}

