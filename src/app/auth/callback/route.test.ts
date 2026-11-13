import { describe, expect, it } from "vitest";
import { sessionCookieName } from "@/server/repositories/supabase-session";
import { GET } from "./route";

function callback(query: string): Promise<Response> {
  return GET(new Request(`http://app.test/auth/callback${query}`));
}

function setsSession(response: Response): boolean {
  return response.headers.getSetCookie().some((cookie) => {
    const [pair = ""] = cookie.split(";");
    const [name = "", value = ""] = pair.split("=");
    return name.startsWith(sessionCookieName()) && value !== "";
  });
}

describe("GET /auth/callback", () => {
  it("sends a cancelled sign-in back where it started, signed out", async () => {
    const response = await callback(`?error=access_denied&next=${encodeURIComponent("/?room=x")}`);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://app.test/?room=x");
    expect(setsSession(response)).toBe(false);
  });

  it.each(["", "?code=", "?code=not-a-real-code"])(
    "sends a missing or invalid code (%j) back to next, signed out, never a 500",
    async (query) => {
      const next = encodeURIComponent("/?room=x");
      const response = await callback(`${query}${query ? "&" : "?"}next=${next}`);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://app.test/?room=x");
      expect(setsSession(response)).toBe(false);
    },
  );

  it.each(["//evil.com", "https://evil.com", "/\\evil.com"])("keeps a crafted next (%s) on the site", async (next) => {
    const response = await callback(`?code=x&next=${encodeURIComponent(next)}`);
    expect(new URL(response.headers.get("location") ?? "").origin).toBe("http://app.test");
  });

  it("goes to the home page without a next", async () => {
    const response = await callback("?error=access_denied");
    expect(response.headers.get("location")).toBe("http://app.test/");
  });
});
