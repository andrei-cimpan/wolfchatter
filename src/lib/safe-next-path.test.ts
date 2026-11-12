import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it.each(["/", "/?room=abc", "/?room=0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a", "/some/path?x=1#y"])(
    "keeps the path %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    null,
    "",
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "\\evil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "/%2F%2Fevil.com",
    "javascript:alert(1)",
    "room=abc",
    "/\tevil.com",
    "/\n/evil.com",
  ])("turns %j into /", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });
});
