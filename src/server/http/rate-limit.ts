import { rateLimited } from "./api-errors";
import { clientIp } from "./client-ip";

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(): void;
  /** Keys currently tracked; shows that expired ones are dropped. */
  size(): number;
}

type Window = { start: number; count: number };

/**
 * Fixed-window counter per key, held in this process's memory. Each app instance counts on its
 * own, so N instances allow N times the limit; production adds a per-IP rule at the WAF.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, now = Date.now } = options;
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

// Creating rooms litters the map for everyone, so it gets the tighter budget. Messages allow a
// lively conversation (one every two seconds) while stopping a script from flooding a room.
export const roomCreationLimiter = createRateLimiter({ limit: 10, windowMs: MINUTE });
export const messagePostLimiter = createRateLimiter({ limit: 30, windowMs: MINUTE });

/** Counts the request against its IP, and returns the 429 to send once the budget is spent. */
export function enforceRateLimit(limiter: RateLimiter, request: Request): Response | null {
  const result = limiter.check(clientIp(request));
  return result.allowed ? null : rateLimited(result.retryAfterSeconds);
}
