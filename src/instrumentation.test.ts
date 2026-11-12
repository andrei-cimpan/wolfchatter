import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

describe("register", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("RATE_LIMIT_ROOMS_PER_MINUTE", "");
    vi.stubEnv("RATE_LIMIT_MESSAGES_PER_MINUTE", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // A real exit never returns, so neither does this.
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["RATE_LIMIT_ROOMS_PER_MINUTE", "RATE_LIMIT_MESSAGES_PER_MINUTE"])(
    "exits with an error on a typo in %s",
    async (name) => {
      vi.stubEnv(name, "abc");
      await expect(register()).rejects.toThrow("exit 1");
      expect(console.error).toHaveBeenCalledWith(
        "Invalid configuration",
        expect.objectContaining({ message: expect.stringContaining(name) as string }),
      );
    },
  );

  it("starts normally with valid limits", async () => {
    vi.stubEnv("RATE_LIMIT_ROOMS_PER_MINUTE", "20");
    await register();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
