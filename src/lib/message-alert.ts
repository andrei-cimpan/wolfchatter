import type { Ding } from "./ding";
import type { Message } from "./types";

export type AlertKind = "none" | "ding" | "notify";

export type AlertInput = {
  posterId: string | null;
  /** The signed-in user's id, null when signed out. */
  myId: string | null;
  enabled: boolean;
  inFront: boolean;
};

/** What a live message from someone else raises: a ding if you are looking, a notification too if not. */
export function alertFor({ posterId, myId, enabled, inFront }: AlertInput): AlertKind {
  if (!enabled) return "none";
  if (myId !== null && posterId === myId) return "none";
  return inFront ? "ding" : "notify";
}

/**
 * Visible alone is not enough: a window behind another app is visible, yet nobody is looking at
 * it, so it gets the notification.
 */
export function isInFront(page: Pick<Document, "visibilityState" | "hasFocus">): boolean {
  return page.visibilityState === "visible" && page.hasFocus();
}

const BODY_LIMIT = 100;

/** The start of the message, cut at a code point so an emoji is never split. */
export function notificationBody(body: string): string {
  const characters = Array.from(body);
  return characters.length > BODY_LIMIT ? `${characters.slice(0, BODY_LIMIT).join("")}…` : body;
}

/** The part of the `Notification` API used here, so tests can pass a fake. */
export type NotificationApi = {
  readonly permission: NotificationPermission;
  new (title: string, options: NotificationOptions): Pick<Notification, "onclick" | "close">;
};

export type AlertDeps = {
  ding: Pick<Ding, "play">;
  notifications: NotificationApi | undefined;
  focusWindow: () => void;
};

export function browserAlertDeps(ding: Pick<Ding, "play">): AlertDeps {
  return {
    ding,
    notifications: typeof Notification === "undefined" ? undefined : Notification,
    focusWindow: () => window.focus(),
  };
}

export function showAlert(kind: AlertKind, message: Message, roomTitle: string | null, deps: AlertDeps): void {
  if (kind === "none") return;
  deps.ding.play();
  if (kind !== "notify" || deps.notifications?.permission !== "granted") return;
  try {
    // The system draws title and body as plain text. One tag per room, so a busy room replaces its
    // notification rather than stacking them; silent, since the ding already played.
    const notification = new deps.notifications(roomTitle ? `${message.author} in ${roomTitle}` : message.author, {
      body: notificationBody(message.body),
      tag: message.roomId,
      silent: true,
    });
    notification.onclick = () => {
      deps.focusWindow();
      notification.close();
    };
  } catch {
    // Android Chrome refuses notifications made outside a service worker; the ding has played.
  }
}
