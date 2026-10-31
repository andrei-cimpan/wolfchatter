import pg from "pg";

// Next dev re-evaluates modules on every edit; keeping the pool on globalThis stops each
// reload from opening another set of connections.
const globalForDb = globalThis as typeof globalThis & { wolfchatterPool?: pg.Pool };

export function databaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return connectionString;
}

export function getPool(): pg.Pool {
  if (!globalForDb.wolfchatterPool) {
    const pool = new pg.Pool({ connectionString: databaseUrl() });
    // An idle client dropped by the server (restart, failover, idle timeout) is emitted as 'error';
    // unhandled, that kills the process. The pool already discards the client and reconnects on demand.
    pool.on("error", (error) => console.error("Postgres pool: idle client error", error));
    globalForDb.wolfchatterPool = pool;
  }
  return globalForDb.wolfchatterPool;
}
