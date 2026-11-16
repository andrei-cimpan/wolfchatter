import { describe, expect, it, vi } from "vitest";
import { createNotifyPreference, NOTIFY_KEY } from "./notify-preference";

class FakeStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

class FakeWindow {
  listeners: ((event: { key: string | null }) => void)[] = [];
  addEventListener(_type: "storage", listener: (event: { key: string | null }) => void) {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "storage", listener: (event: { key: string | null }) => void) {
    this.listeners = this.listeners.filter((other) => other !== listener);
  }
  fire(key: string | null) {
    for (const listener of this.listeners) listener({ key });
  }
}

function setup(storage: () => FakeStorage | null = () => new FakeStorage()) {
  const store = storage();
  const win = new FakeWindow();
  return { preference: createNotifyPreference({ storage: () => store, target: win }), store, win };
}

describe("notify preference", () => {
  it("is off until turned on, and remembers both ways", () => {
    const { preference, store } = setup();
    expect(preference.get()).toBe(false);
    preference.set(true);
    expect(preference.get()).toBe(true);
    expect(store!.getItem(NOTIFY_KEY)).toBe("on");
    preference.set(false);
    expect(preference.get()).toBe(false);
    expect(store!.getItem(NOTIFY_KEY)).toBeNull();
  });

  it("reads anything else stored as off", () => {
    const { preference, store } = setup();
    store!.setItem(NOTIFY_KEY, "yes");
    expect(preference.get()).toBe(false);
  });

  it("tells subscribers about a change here, and one made in another tab", () => {
    const { preference, store, win } = setup();
    const listener = vi.fn();
    const unsubscribe = preference.subscribe(listener);
    preference.set(true);
    expect(listener).toHaveBeenCalledTimes(1);

    store!.setItem(NOTIFY_KEY, "on");
    win.fire("other-key");
    expect(listener).toHaveBeenCalledTimes(1);
    win.fire(NOTIFY_KEY);
    // Clearing all storage fires with a null key.
    win.fire(null);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    preference.set(false);
    win.fire(NOTIFY_KEY);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(win.listeners).toHaveLength(0);
  });

  it("reads as off and stays usable where storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const preference = createNotifyPreference({ storage: () => blocked, target: new FakeWindow() });
    expect(preference.get()).toBe(false);
    expect(() => preference.set(true)).not.toThrow();
  });

  it("reads as off with no storage at all, as on the server", () => {
    const preference = createNotifyPreference({ storage: () => null, target: undefined });
    expect(preference.get()).toBe(false);
    expect(preference.subscribe(() => {})).toBeTypeOf("function");
  });
});
