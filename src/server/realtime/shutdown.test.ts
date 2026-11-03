import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeStreamsOnShutdown, SHUTDOWN_DEADLINE_MS } from "./shutdown";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(stop = vi.fn(() => Promise.resolve())) {
  vi.useFakeTimers();
  const signals = new EventEmitter();
  const exit = vi.fn();
  closeStreamsOnShutdown(signals, stop, exit);
  return { signals, stop, exit };
}

describe("closeStreamsOnShutdown", () => {
  it("does nothing until a signal arrives", () => {
    const { stop, exit } = setup();
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS * 2);
    expect(stop).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ])("on %s stops the hub at once and exits with %i at the deadline", (signal, code) => {
    const { signals, stop, exit } = setup();
    signals.emit(signal);
    expect(stop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(code);
  });

  it("does not restart the deadline when a second signal arrives", () => {
    const { signals, stop, exit } = setup();
    signals.emit("SIGINT");
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS - 1);
    signals.emit("SIGINT");
    expect(stop).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("still exits at the deadline when stopping fails, and logs why", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("listener already gone");
    const { signals, exit } = setup(vi.fn(() => Promise.reject(failure)));
    signals.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
    expect(log).toHaveBeenCalledWith("Realtime hub: stopping at shutdown failed", failure);
    expect(exit).toHaveBeenCalledExactlyOnceWith(143);
  });
});
