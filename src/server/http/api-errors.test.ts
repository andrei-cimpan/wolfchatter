import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiError, readJson, roomNotFound, validationError, withErrorHandling } from "./api-errors";

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
    expect(body.error.message).not.toMatch(/^: /);
  });
});

describe("readJson", () => {
  const post = (body: string) => new Request("http://test/", { method: "POST", body });

  it("returns the parsed body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });

  it.each(["", "{", "not json"])("rejects %j with 400 invalid_json", async (body) => {
    const result = await readJson(post(body));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({ error: { code: "invalid_json" } });
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
