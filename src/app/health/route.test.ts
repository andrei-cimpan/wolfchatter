import { afterAll, describe, expect, it, vi } from "vitest";
import { getPool } from "@/server/repositories/db";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET } from "./route";

// It throws outside a request. The Docker smoke test in CI runs the real thing.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

setupTestDatabase();
// The route uses the app's shared pool; leaving it open keeps the test worker alive.
afterAll(() => getPool().end());

describe("GET /health", () => {
  it("answers ok with the real database", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
