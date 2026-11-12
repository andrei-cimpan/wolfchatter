import { ApiError } from "./api-client";

/**
 * The retry rule for every API query: one retry for a network failure or server error. TanStack's
 * default of three with backoff kept "Loading chatroom…" on screen for about 7 seconds; a 4xx will
 * not fix itself, so never retry it.
 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 1;
}
