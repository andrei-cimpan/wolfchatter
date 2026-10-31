import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JSON_BODY_MAX_BYTES, apiError, readJson, roomNotFound, validationError, withErrorHandling } from "./api-errors";

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

  it("accepts a body of exactly JSON_BODY_MAX_BYTES", async () => {
    const json = '{"a":1}';
    const body = json + " ".repeat(JSON_BODY_MAX_BYTES - json.length);
    expect(await readJson(post(body))).toEqual({ ok: true, value: { a: 1 } });
  });

  it("strips a leading byte order mark, as request.json() does", async () => {
    expect(await readJson(post('﻿{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });

  async function expectTooLarge(request: Request) {
    const result = await readJson(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(await result.response.json()).toMatchObject({ error: { code: "payload_too_large" } });
  }

  it("rejects a body one byte over the limit with 413", async () => {
    await expectTooLarge(post(`"${"x".repeat(JSON_BODY_MAX_BYTES - 1)}"`));
  });

  it("counts bytes, not characters", async () => {
    // 3 bytes each in UTF-8, so this is under the limit in characters but over it in bytes.
    await expectTooLarge(post(`"${"€".repeat(JSON_BODY_MAX_BYTES / 2)}"`));
  });

  it("stops reading a streamed body without Content-Length once it passes the limit", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
    });
    await expectTooLarge(new Request("http://test/", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(pulls).toBeLessThan(JSON_BODY_MAX_BYTES / 1024 + 5);
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const request = new Request("http://test/", { method: "POST", body: "{}", headers: { "content-length": "999999999" } });
    await expectTooLarge(request);
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
