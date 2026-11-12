import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { shouldRetryQuery } from "./query-retry";

describe("shouldRetryQuery", () => {
  it("retries a server error or network failure once", () => {
    expect(shouldRetryQuery(0, new ApiError(500, "internal_error", "x"))).toBe(true);
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(503, "http_error", "x"))).toBe(false);
  });

  it("never retries a client error, which will not fix itself", () => {
    expect(shouldRetryQuery(0, new ApiError(400, "validation_error", "x"))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(429, "rate_limited", "x"))).toBe(false);
  });
});
