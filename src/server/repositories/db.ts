import pg from "pg";

// Next dev re-evaluates modules on every edit; keeping the pool on globalThis stops each
// reload from opening another set of connections.
const globalForDb = globalThis as typeof globalThis & { wolfchatterPool?: pg.Pool };

export function getPool(): pg.Pool {
  if (!globalForDb.wolfchatterPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
    globalForDb.wolfchatterPool = new pg.Pool({ connectionString });
  }
  return globalForDb.wolfchatterPool;
}
