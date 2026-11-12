import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiError, rateLimited, roomNotFound, validationError, withErrorHandling } from "./api-errors";

describe("apiError", () => {
  it("uses the shared error shape and status", async () => {
    const response = apiError(400, "validation_error", "Bad");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: { code: "validation_error", message: "Bad" } });
  });

  it("answers an unknown room with 404 room_not_found", async () => {
    const response = roomNotFound();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "room_not_found" } });
  });

  it("answers a spent budget with 429 rate_limited and Retry-After", async () => {
    const response = rateLimited(42);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toMatchObject({ error: { code: "rate_limited" } });
  });
});

describe("validationError", () => {
  it("prefixes the first issue with its path", async () => {
    const result = z.object({ lat: z.number().max(90) }).safeParse({ lat: 91 });
    const body = await validationError(result.error!).json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toMatch(/^lat: /);
  });

  it("omits the prefix for a root-level issue", async () => {
    const result = z.object({}).safeParse([]);
    const body = await validationError(result.error!).json();
    expect(body.error.message).toBe(result.error!.issues[0]!.message);
    expect(body.error.message).not.toBe("");
  });
});

describe("withErrorHandling", () => {
  it("passes successful responses through", async () => {
    const handler = withErrorHandling(async (n: number) => Response.json({ n }));
    expect(await (await handler(2)).json()).toEqual({ n: 2 });
  });

  it("turns a throw into a generic 500 and logs the cause", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new Error("connection refused at 10.0.0.5");
    });
    const response = await handler();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "internal_error", message: "Something went wrong" } });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
