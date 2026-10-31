import { rateLimited } from "./api-errors";
import { clientIp, rateLimitKey } from "./client-ip";

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  check(key: string): RateLimitResult;
  /** Test hook: clears every budget, since the route limiters are shared module state. */
  reset(): void;
  /** Test hook: keys currently tracked, to prove expired keys are swept and the cap holds. */
  size(): number;
}

type Window = { start: number; count: number };

// About 1 MB per limiter, and far more distinct IPs than one instance sees in a minute.
const DEFAULT_MAX_KEYS = 10_000;

/**
 * Fixed-window counter per key, held in this process's memory. Each app instance counts on its
 * own, so N instances allow N times the limit; production adds a per-IP rule at the WAF.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** Most keys held at once; past it the oldest window is dropped. */
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = DEFAULT_MAX_KEYS, now = Date.now } = options;
  // Insertion order is window start order (a restarted window is re-inserted), so the first entry
  // is always the oldest window and eviction is O(1).
  const windows = new Map<string, Window>();
  let nextSweep = 0;

  // Without a sweep, every IP ever seen would stay in the map; one pass per window keeps it to
  // the keys active in roughly the last two windows.
  function sweep(time: number) {
    if (time < nextSweep) return;
    nextSweep = time + windowMs;
    for (const [key, window] of windows) {
      if (time - window.start >= windowMs) windows.delete(key);
    }
  }

  return {
    check(key) {
      const time = now();
      sweep(time);
      const window = windows.get(key);
      if (!window || time - window.start >= windowMs) {
        windows.delete(key);
        // Many source addresses inside one window (a botnet, or an IPv6 range) would otherwise
        // grow the map without bound. Dropping the oldest window frees its key early, which only
        // matters to a client that is already spreading itself across thousands of addresses.
        if (windows.size >= maxKeys) {
          const oldest = windows.keys().next();
          if (!oldest.done) windows.delete(oldest.value);
        }
        windows.set(key, { start: time, count: 1 });
        return { allowed: true };
      }
      if (window.count < limit) {
        window.count++;
        return { allowed: true };
      }
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - time) / 1000)) };
    },
    reset() {
      windows.clear();
      nextSweep = 0;
    },
    size() {
      return windows.size;
    },
  };
}

const MINUTE = 60_000;

/**
 * A per-minute limit from the environment, or `fallback` when unset. Anything but a positive
 * integer throws, so a typo fails at startup instead of silently changing the limit.
 */
export function limitFromEnv(
  name: string,
  fallback: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer, got "${value}"`);
  return Number(value);
}

// Creating rooms litters the map for everyone, so it gets the tighter budget. Messages allow a
// lively conversation (one every two seconds) while stopping a script from flooding a room.
// Both can be raised for end-to-end tests, where every browser shares one address.
export const roomCreationLimiter = createRateLimiter({
  limit: limitFromEnv("RATE_LIMIT_ROOMS_PER_MINUTE", 10),
  windowMs: MINUTE,
});
export const messagePostLimiter = createRateLimiter({
  limit: limitFromEnv("RATE_LIMIT_MESSAGES_PER_MINUTE", 30),
  windowMs: MINUTE,
});

/** Counts the request against its IP, and returns the 429 to send once the budget is spent. */
export function enforceRateLimit(limiter: RateLimiter, request: Request): Response | null {
  const result = limiter.check(rateLimitKey(clientIp(request)));
  return result.allowed ? null : rateLimited(result.retryAfterSeconds);
}
