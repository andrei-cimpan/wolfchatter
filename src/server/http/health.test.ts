import { afterEach, describe, expect, it, vi } from "vitest";
import { healthResponse } from "./health";

afterEach(() => vi.restoreAllMocks());

describe("healthResponse", () => {
  it("answers ok when the database does", async () => {
    const response = await healthResponse(() => Promise.resolve());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 503 when the database fails, and keeps the reason for the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("password authentication failed for user secret");
    const response = await healthResponse(() => Promise.reject(failure));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"unavailable"}');
    expect(log).toHaveBeenCalledWith("Health check failed", failure);
  });

  it("answers 503 when the database does not answer in time", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await healthResponse(() => new Promise(() => {}), 5);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("is never cached", async () => {
    const response = await healthResponse(() => Promise.resolve());
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
