import { describe, expect, it, vi } from "vitest";
import { sessionCookieHeader } from "@/server/repositories/test/session-cookies";
import { setupTestDatabase } from "@/server/repositories/test/test-db";
import { createTestUser } from "@/server/repositories/test/test-users";
import { GET } from "./route";

setupTestDatabase();

describe("GET /api/me", () => {
  it("answers null when signed out, and is never cached", async () => {
    const response = await GET(new Request("http://test/api/me"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers the signed-in user's author name", async () => {
    const { session } = await createTestUser({ full_name: "Ana Popescu" });
    const response = await GET(
      new Request("http://test/api/me", { headers: { cookie: await sessionCookieHeader(session) } }),
    );
    expect(await response.json()).toEqual({ name: "Ana P." });
  });

  // A route has no response to save a refreshed session to, so a refresh there would rotate the
  // refresh token away and sign the user out; the proxy refreshes instead (PR #31 review #1).
  it("never refreshes a nearly expired session itself", async () => {
    const { session } = await createTestUser({ full_name: "Ana Popescu" });
    const nearlyExpired = { ...session, expires_at: Math.floor(Date.now() / 1000) + 30 };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const response = await GET(
        new Request("http://test/api/me", { headers: { cookie: await sessionCookieHeader(nearlyExpired) } }),
      );
      expect(await response.json()).toEqual({ name: "Ana P." });
      const urls = fetchSpy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
      expect(urls.filter((url) => url.includes("/auth/v1/token"))).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("answers null for a session that has expired, rather than failing", async () => {
    const { session } = await createTestUser({ full_name: "Ana Popescu" });
    const expired = { ...session, expires_at: Math.floor(Date.now() / 1000) - 60 };
    const response = await GET(
      new Request("http://test/api/me", { headers: { cookie: await sessionCookieHeader(expired) } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: null });
  });
});
