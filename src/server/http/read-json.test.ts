import { describe, expect, it } from "vitest";
import { JSON_BODY_MAX_BYTES, readJson } from "./read-json";

describe("readJson", () => {
  const JSON_TYPE = { "content-type": "application/json" };
  const post = (body: string, headers: Record<string, string> = JSON_TYPE) =>
    new Request("http://test/", { method: "POST", body, headers });

  it("returns the parsed body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });

  it.each(["application/json", "application/json; charset=utf-8", " APPLICATION/JSON ;charset=UTF-8"])(
    "accepts Content-Type %j",
    async (contentType) => {
      expect(await readJson(post('{"a":1}', { "content-type": contentType }))).toEqual({ ok: true, value: { a: 1 } });
    },
  );

  it.each([
    "",
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/x-json",
    "application/problem+json",
    "application/jsonx",
  ])("rejects Content-Type %j with 415 unsupported_media_type", async (contentType) => {
    const result = await readJson(post('{"a":1}', { "content-type": contentType }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(415);
    expect(await result.response.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
  });

  it("rejects a request with no Content-Type header with 415", async () => {
    const request = new Request("http://test/", { method: "POST" });
    const result = await readJson(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(415);
  });

  it("checks Content-Type before reading the body", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1));
      },
    });
    const request = new Request("http://test/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const result = await readJson(request);
    expect(result.ok).toBe(false);
    expect(pulls).toBeLessThanOrEqual(1);
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
    await expectTooLarge(
      new Request("http://test/", { method: "POST", body: stream, headers: JSON_TYPE, duplex: "half" } as RequestInit),
    );
    expect(pulls).toBeLessThan(JSON_BODY_MAX_BYTES / 1024 + 5);
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const request = new Request("http://test/", { method: "POST", body: "{}", headers: { ...JSON_TYPE, "content-length": "999999999" } });
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
