import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { shouldRetryRoomQuery } from "./useRoom";

describe("shouldRetryRoomQuery", () => {
  it("retries a server error or network failure once", () => {
    expect(shouldRetryRoomQuery(0, new ApiError(500, "internal_error", "x"))).toBe(true);
    expect(shouldRetryRoomQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryRoomQuery(1, new ApiError(503, "http_error", "x"))).toBe(false);
  });

  it("never retries a client error, which will not fix itself", () => {
    expect(shouldRetryRoomQuery(0, new ApiError(400, "validation_error", "x"))).toBe(false);
    expect(shouldRetryRoomQuery(0, new ApiError(429, "rate_limited", "x"))).toBe(false);
  });
});
