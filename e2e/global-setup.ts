import { execFileSync } from "node:child_process";
import pg from "pg";
import {
  createDatabaseIfMissing,
  scratchDatabaseName,
} from "../src/server/repositories/test/scratch-database";

// E2E tests create rooms through the real app, so they get their own database, emptied once per
// run. Tests must not depend on each other's rooms; emptying only keeps the map from filling up.
export default async function globalSetup(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL;
  const name = scratchDatabaseName("E2E_DATABASE_URL", url, process.env.DATABASE_URL, "e2e");
  await createDatabaseIfMissing(url!, name);
  // Playwright compiles this file to CommonJS, which cannot load the ESM migration runner, so run
  // it as `npm run db:migrate` does. Node's --env-file never overrides a variable already set.
  execFileSync(process.execPath, ["scripts/migrate.mts"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("truncate rooms cascade");
  } finally {
    await client.end();
  }
}
