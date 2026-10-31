import { describe, expect, it } from "vitest";
import { createRateLimiter, enforceRateLimit } from "./rate-limit";

function setup(limit = 3, windowMs = 60_000) {
  let time = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => time });
  return {
    limiter,
    advance(ms: number) {
      time += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows up to the limit and blocks the next request", () => {
    const { limiter } = setup(3);
    expect([1, 2, 3].map(() => limiter.check("a").allowed)).toEqual([true, true, true]);
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("tells the caller how long until the window ends, rounded up", () => {
    const { limiter, advance } = setup(1);
    limiter.check("a");
    advance(59_500);
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("starts a fresh budget once the window has passed", () => {
    const { limiter, advance } = setup(1);
    limiter.check("a");
    advance(59_999);
    expect(limiter.check("a").allowed).toBe(false);
    advance(1);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("keeps each key's budget separate", () => {
    const { limiter } = setup(1);
    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("does not let blocked requests extend the window", () => {
    const { limiter, advance } = setup(1);
    limiter.check("a");
    for (let i = 0; i < 5; i++) {
      advance(10_000);
      limiter.check("a");
    }
    advance(10_000);
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("forgets keys whose window has expired", () => {
    const { limiter, advance } = setup(1);
    for (const key of ["a", "b", "c"]) limiter.check(key);
    expect(limiter.size()).toBe(3);
    advance(60_000);
    limiter.check("d");
    expect(limiter.size()).toBe(1);
  });

  it("keeps keys whose window is still open", () => {
    const { limiter, advance } = setup(1);
    limiter.check("a");
    advance(30_000);
    limiter.check("b");
    advance(30_000);
    limiter.check("c");
    // "a" expired; "b" is mid-window, so it must survive the sweep and stay blocked.
    expect(limiter.size()).toBe(2);
    expect(limiter.check("b").allowed).toBe(false);
  });

  it("clears every budget on reset", () => {
    const { limiter } = setup(1);
    limiter.check("a");
    limiter.reset();
    expect(limiter.check("a").allowed).toBe(true);
  });
});

describe("enforceRateLimit", () => {
  const request = new Request("http://test/", { headers: { "x-forwarded-for": "203.0.113.7" } });

  it("returns null while the IP has budget, then a 429", async () => {
    const { limiter } = setup(1);
    expect(enforceRateLimit(limiter, request)).toBeNull();
    const response = enforceRateLimit(limiter, request);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.json()).toMatchObject({ error: { code: "rate_limited" } });
  });
});
