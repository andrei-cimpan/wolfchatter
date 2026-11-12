import { describe, expect, it } from "vitest";
import { signInRedirectTo } from "./auth";

describe("signInRedirectTo", () => {
  it("returns through /auth/callback to the same page and room", () => {
    const url = signInRedirectTo({ origin: "http://localhost:3000", pathname: "/", search: "?room=abc" });
    expect(url).toBe("http://localhost:3000/auth/callback?next=%2F%3Froom%3Dabc");
    expect(new URL(url).searchParams.get("next")).toBe("/?room=abc");
  });

  it("returns to the home page from it", () => {
    expect(signInRedirectTo({ origin: "https://app.example", pathname: "/", search: "" })).toBe(
      "https://app.example/auth/callback?next=%2F",
    );
  });
});
