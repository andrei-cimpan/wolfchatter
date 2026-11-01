import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTHOR_MAX } from "./limits";
import { readSavedUsername, saveUsername } from "./saved-username";

const KEY = "wolfchatter.username";

function stubStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
  });
  return items;
}

// Blocked storage can throw as soon as `localStorage` is touched, not only on a read or write.
function stubBlockedStorage() {
  vi.stubGlobal("window", {
    get localStorage(): never {
      throw new Error("The operation is insecure.");
    },
  });
}

function stubFullStorage() {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("Quota exceeded");
      },
      removeItem: () => {
        throw new Error("Quota exceeded");
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSavedUsername", () => {
  it("returns the saved name", () => {
    stubStorage({ [KEY]: "ana" });
    expect(readSavedUsername()).toBe("ana");
  });

  it("returns an empty string when nothing is saved", () => {
    stubStorage();
    expect(readSavedUsername()).toBe("");
  });

  it("accepts a name of exactly the maximum length", () => {
    const name = "a".repeat(AUTHOR_MAX);
    stubStorage({ [KEY]: name });
    expect(readSavedUsername()).toBe(name);
  });

  it("ignores a value too long to post, which maxLength would not catch", () => {
    stubStorage({ [KEY]: "a".repeat(AUTHOR_MAX + 1) });
    expect(readSavedUsername()).toBe("");
  });

  it.each([
    ["spaces", "   "],
    ["zero-width characters, which trim() keeps", "​​"],
  ])("ignores a saved value of only %s", (_label, text) => {
    stubStorage({ [KEY]: text });
    expect(readSavedUsername()).toBe("");
  });

  it("trims a saved value", () => {
    stubStorage({ [KEY]: " ana " });
    expect(readSavedUsername()).toBe("ana");
  });

  it("returns an empty string when storage is blocked", () => {
    stubBlockedStorage();
    expect(readSavedUsername()).toBe("");
  });

  it("returns an empty string on the server, where there is no window", () => {
    expect(readSavedUsername()).toBe("");
  });
});

describe("saveUsername", () => {
  it("stores the name trimmed, for the next read", () => {
    const items = stubStorage();
    saveUsername("  ana b ");
    expect(items.get(KEY)).toBe("ana b");
    expect(readSavedUsername()).toBe("ana b");
  });

  it("forgets the name when the field is emptied", () => {
    const items = stubStorage({ [KEY]: "ana" });
    saveUsername("");
    expect(items.has(KEY)).toBe(false);
  });

  it.each([
    ["spaces", "   "],
    ["zero-width characters, which trim() keeps", "​​"],
  ])("forgets the name when the field holds only %s", (_label, text) => {
    const items = stubStorage({ [KEY]: "ana" });
    saveUsername(text);
    expect(items.has(KEY)).toBe(false);
  });

  it("does not throw when storage is blocked or full", () => {
    stubBlockedStorage();
    expect(() => saveUsername("ana")).not.toThrow();
    stubFullStorage();
    expect(() => saveUsername("ana")).not.toThrow();
    expect(() => saveUsername("")).not.toThrow();
  });

  it("does nothing on the server, where there is no window", () => {
    expect(() => saveUsername("ana")).not.toThrow();
  });
});
