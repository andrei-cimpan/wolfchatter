import { migrate } from "../../../../scripts/migrate.mts";
import { createDatabaseIfMissing, scratchDatabaseName } from "./scratch-database";

export function testDatabaseName(testUrl: string | undefined, devUrl: string | undefined): string {
  return scratchDatabaseName("TEST_DATABASE_URL", testUrl, devUrl, "test");
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
