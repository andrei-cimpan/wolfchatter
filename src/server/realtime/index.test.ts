import { afterAll, describe, expect, it, vi } from "vitest";
import { getRealtimeHub, stopRealtimeHub } from ".";

afterAll(stopRealtimeHub);

describe("getRealtimeHub", () => {
  it("returns the same hub on every call", () => {
    expect(getRealtimeHub()).toBe(getRealtimeHub());
  });
});

describe("stopRealtimeHub", () => {
  it("closes the hub's streams, and the next call starts a new hub", async () => {
    const hub = getRealtimeHub();
    const close = vi.fn();
    await hub.subscribe("room", { send: () => {}, close });

    await stopRealtimeHub();

    expect(close).toHaveBeenCalledOnce();
    expect(getRealtimeHub()).not.toBe(hub);
  });

  it("does nothing when no hub exists", async () => {
    await stopRealtimeHub();
    await expect(stopRealtimeHub()).resolves.toBeUndefined();
  });
});
