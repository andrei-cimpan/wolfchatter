import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseConfigFromEnv } from "./config";

const URL = "http://127.0.0.1:54321";
const KEY = "anon-key";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supabaseConfigFromEnv", () => {
  it("returns the project URL and anon key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", KEY);
    expect(supabaseConfigFromEnv()).toEqual({ url: URL, anonKey: KEY });
  });

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", undefined, KEY],
    ["NEXT_PUBLIC_SUPABASE_URL", "  ", KEY],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", URL, undefined],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", URL, ""],
  ])("throws naming %s when it is missing or blank", (name, url, key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", key);
    expect(supabaseConfigFromEnv).toThrow(name);
  });
});
