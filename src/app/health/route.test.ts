import { describe, expect, it, vi } from "vitest";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { GET } from "./route";

// It throws outside a request. The Docker smoke test in CI runs the real thing.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

setupTestDatabase();

describe("GET /health", () => {
  it("answers ok with the real database", async () => {
    const response = await GET(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
