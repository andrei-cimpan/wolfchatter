import { describe, expect, it, vi } from "vitest";
import { alertFor, isInFront, notificationBody, showAlert, type AlertDeps, type NotificationApi } from "./message-alert";
import type { Message } from "./types";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

describe("alertFor", () => {
  const base = { posterId: THEM, myId: ME, enabled: true, inFront: true };

  it("is nothing while turned off", () => {
    expect(alertFor({ ...base, enabled: false })).toBe("none");
    expect(alertFor({ ...base, enabled: false, inFront: false })).toBe("none");
  });

  it("is nothing for your own message, in front or not", () => {
    expect(alertFor({ ...base, posterId: ME })).toBe("none");
    expect(alertFor({ ...base, posterId: ME, inFront: false })).toBe("none");
  });

  it("is a ding when the tab is in front, and a notification when it is not", () => {
    expect(alertFor(base)).toBe("ding");
    expect(alertFor({ ...base, inFront: false })).toBe("notify");
  });

  it("alerts a signed-out reader, who has no posts of their own", () => {
    expect(alertFor({ ...base, myId: null })).toBe("ding");
    expect(alertFor({ ...base, myId: null, posterId: null })).toBe("ding");
  });
});

describe("isInFront", () => {
  it("needs the page both visible and focused", () => {
    expect(isInFront({ visibilityState: "visible", hasFocus: () => true })).toBe(true);
    expect(isInFront({ visibilityState: "visible", hasFocus: () => false })).toBe(false);
    expect(isInFront({ visibilityState: "hidden", hasFocus: () => true })).toBe(false);
  });
});

describe("notificationBody", () => {
  it("keeps up to 100 characters, counting an emoji once, and marks a cut", () => {
    expect(notificationBody("hi")).toBe("hi");
    expect(notificationBody("a".repeat(100))).toBe("a".repeat(100));
    expect(notificationBody("a".repeat(101))).toBe(`${"a".repeat(100)}…`);
    expect(notificationBody("😀".repeat(101))).toBe(`${"😀".repeat(100)}…`);
  });
});

const message: Message = {
  id: "33333333-3333-4333-8333-333333333333",
  roomId: "44444444-4444-4444-8444-444444444444",
  author: "Ana P.",
  body: "Coffee at the fountain?",
  createdAt: "2026-11-16T10:00:00.000Z",
};

type Shown = {
  title: string;
  options: NotificationOptions;
  closed: boolean;
  onclick: (() => void) | null;
  close(): void;
};

function fakes(permission: NotificationPermission = "granted", { throws = false } = {}) {
  const shown: Shown[] = [];
  const Fake = vi.fn(function (this: Shown, title: string, options: NotificationOptions) {
    if (throws) throw new TypeError("Illegal constructor");
    this.title = title;
    this.options = options;
    this.closed = false;
    this.onclick = null;
    this.close = () => {
      this.closed = true;
    };
    shown.push(this);
  } as unknown as NotificationApi) as unknown as NotificationApi;
  Object.assign(Fake, { permission });
  const deps: AlertDeps = { ding: { play: vi.fn() }, notifications: Fake, focusWindow: vi.fn() };
  return { deps, shown };
}

describe("showAlert", () => {
  it("does nothing for none", () => {
    const { deps, shown } = fakes();
    showAlert("none", message, "Fountain", deps);
    expect(deps.ding.play).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
  });

  it("only dings for ding", () => {
    const { deps, shown } = fakes();
    showAlert("ding", message, "Fountain", deps);
    expect(deps.ding.play).toHaveBeenCalledOnce();
    expect(shown).toHaveLength(0);
  });

  it("dings and shows one silent notification per room for notify", () => {
    const { deps, shown } = fakes();
    showAlert("notify", message, "Fountain", deps);
    expect(deps.ding.play).toHaveBeenCalledOnce();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe("Ana P. in Fountain");
    expect(shown[0]!.options).toEqual({ body: "Coffee at the fountain?", tag: message.roomId, silent: true });
  });

  it("names only the author when the room's title is not known", () => {
    const { deps, shown } = fakes();
    showAlert("notify", message, null, deps);
    expect(shown[0]!.title).toBe("Ana P.");
  });

  it("brings the tab back and closes the notification when clicked", () => {
    const { deps, shown } = fakes();
    showAlert("notify", message, "Fountain", deps);
    shown[0]!.onclick!();
    expect(deps.focusWindow).toHaveBeenCalledOnce();
    expect(shown[0]!.closed).toBe(true);
  });

  it("still dings without permission, or without notifications at all", () => {
    for (const permission of ["default", "denied"] as const) {
      const { deps, shown } = fakes(permission);
      showAlert("notify", message, "Fountain", deps);
      expect(deps.ding.play).toHaveBeenCalledOnce();
      expect(shown).toHaveLength(0);
    }
    const { deps } = fakes();
    showAlert("notify", message, "Fountain", { ...deps, notifications: undefined });
    expect(deps.ding.play).toHaveBeenCalledOnce();
  });

  // Android Chrome only shows notifications through a service worker.
  it("still dings where the browser refuses to construct a notification", () => {
    const { deps } = fakes("granted", { throws: true });
    expect(() => showAlert("notify", message, "Fountain", deps)).not.toThrow();
    expect(deps.ding.play).toHaveBeenCalledOnce();
  });
});
