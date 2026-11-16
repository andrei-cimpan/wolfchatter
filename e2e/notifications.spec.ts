import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { messages, panel } from "./chat-page";
import { expect, serveBlankTiles, signInAs, test, watchLiveConnection, type LiveConnection } from "./support";

const TURN_ON = "Turn on notifications";
const TURN_OFF = "Turn off notifications";
const BLOCKED_HINT = "Notifications are blocked in your browser's settings. You'll still hear the ding.";

type Recorded = { title: string; options: NotificationOptions };
type Alerts = {
  dings: number;
  notifications: Recorded[];
  permissionRequests: number;
  permission: NotificationPermission;
  /** What the permission prompt answers. */
  answer: NotificationPermission;
  inFront: boolean;
};
declare global {
  interface Window {
    __alerts: Alerts;
  }
}

/**
 * Headless Chromium can neither play nor show these, so the page gets recorders: a ding is an
 * envelope connected to the speakers, a notification is a constructor call. `inFront` stands for
 * the tab being visible and focused, which a test cannot change for real.
 */
async function recordAlerts(page: Page, permission: NotificationPermission = "default", answer: NotificationPermission = "granted") {
  await page.addInitScript(
    ({ permission, answer }) => {
      const alerts: Alerts = { dings: 0, notifications: [], permissionRequests: 0, permission, answer, inFront: true };
      window.__alerts = alerts;
      const destination = {};
      const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      const node = () => ({
        connect(target: unknown) {
          if (target === destination) alerts.dings++;
          return target;
        },
      });
      class FakeAudioContext {
        state = "suspended";
        currentTime = 0;
        destination = destination;
        resume() {
          this.state = "running";
          return Promise.resolve();
        }
        createGain() {
          return { ...node(), gain: param() };
        }
        createOscillator() {
          return { ...node(), frequency: param(), start() {}, stop() {} };
        }
      }
      class FakeNotification {
        static get permission() {
          return alerts.permission;
        }
        static requestPermission() {
          alerts.permissionRequests++;
          alerts.permission = alerts.answer;
          return Promise.resolve(alerts.permission);
        }
        onclick: (() => void) | null = null;
        constructor(title: string, options: NotificationOptions) {
          alerts.notifications.push({ title, options });
        }
        close() {}
      }
      Object.assign(window, { AudioContext: FakeAudioContext, Notification: FakeNotification });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (alerts.inFront ? "visible" : "hidden") });
      document.hasFocus = () => alerts.inFront;
    },
    { permission, answer },
  );
}

const alerts = (page: Page) => page.evaluate(() => window.__alerts);
const setInFront = (page: Page, inFront: boolean) => page.evaluate((value) => (window.__alerts.inFront = value), inFront);
const bell = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true }).locator("visible=true");

/** Someone other than the page's user, posting into rooms. */
async function otherUser(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  await signInAs(context, baseURL, "Ion Ionescu");
  return {
    post: async (roomId: string, body: string) =>
      expect((await context.request.post(`/api/rooms/${roomId}/messages`, { data: { body } })).status()).toBe(201),
    close: () => context.close(),
  };
}

async function newRoom(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/rooms", { data: { lat: 48, lng: 20 } });
  return ((await response.json()) as { id: string }).id;
}

/** Opens the room and waits for its live channel: a message caught up on instead raises nothing. */
async function openLiveRoom(page: Page, live: LiveConnection): Promise<string> {
  const id = await newRoom(page.request);
  await page.goto(`/?room=${id}`);
  await expect(messages(page)).toBeAttached();
  await live.ready(id);
  return id;
}

/** Waits for the message to show, then a moment more for any alert it raises. */
async function arrives(page: Page, body: string) {
  await expect(messages(page).getByText(body)).toBeVisible();
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("nothing alerts until turned on", async ({ page, browser, baseURL }) => {
    await recordAlerts(page);
    const live = await watchLiveConnection(page);
    const ion = await otherUser(browser, baseURL ?? "");
    const id = await openLiveRoom(page, live);

    await ion.post(id, "Anyone here?");
    await arrives(page, "Anyone here?");
    await setInFront(page, false);
    await ion.post(id, "Hello?");
    await arrives(page, "Hello?");

    expect(await alerts(page)).toMatchObject({ dings: 0, notifications: [], permissionRequests: 0 });
    await ion.close();
  });

  test("turned on, a message dings while the tab is in front, and notifies too when it is not", async ({ page, browser, baseURL }) => {
    await recordAlerts(page);
    const live = await watchLiveConnection(page);
    const ion = await otherUser(browser, baseURL ?? "");
    const id = await openLiveRoom(page, live);
    const title = await panel(page).getByRole("heading", { level: 2 }).textContent();

    await bell(page, TURN_ON).click();
    await expect(bell(page, TURN_OFF)).toBeVisible();
    expect((await alerts(page)).permissionRequests).toBe(1);

    await ion.post(id, "In front");
    await arrives(page, "In front");
    expect(await alerts(page)).toMatchObject({ dings: 1, notifications: [] });

    await setInFront(page, false);
    await ion.post(id, "Behind");
    await arrives(page, "Behind");
    const { dings, notifications } = await alerts(page);
    expect(dings).toBe(2);
    expect(notifications).toEqual([{ title: `Ion I. in ${title}`, options: { body: "Behind", tag: id, silent: true } }]);
    await ion.close();
  });

  test("your own messages raise nothing, from this tab or elsewhere", async ({ page }) => {
    await recordAlerts(page, "granted");
    const live = await watchLiveConnection(page);
    const id = await openLiveRoom(page, live);
    await bell(page, TURN_ON).click();

    await panel(page).getByRole("textbox", { name: "Message" }).fill("Typed here");
    await panel(page).getByRole("button", { name: "Submit" }).click();
    await arrives(page, "Typed here");
    // page.request shares the page's session: the same user posting from somewhere else.
    await setInFront(page, false);
    await page.request.post(`/api/rooms/${id}/messages`, { data: { body: "Sent elsewhere" } });
    await arrives(page, "Sent elsewhere");

    expect(await alerts(page)).toMatchObject({ dings: 0, notifications: [] });
  });

  test("with notifications blocked, it says so and still dings", async ({ page, browser, baseURL }) => {
    await recordAlerts(page, "denied");
    const live = await watchLiveConnection(page);
    const ion = await otherUser(browser, baseURL ?? "");
    const id = await openLiveRoom(page, live);
    await expect(panel(page).getByText(BLOCKED_HINT)).toHaveCount(0);

    await bell(page, TURN_ON).click();
    await expect(panel(page).getByText(BLOCKED_HINT)).toBeVisible();

    await setInFront(page, false);
    await ion.post(id, "Can you hear me?");
    await arrives(page, "Can you hear me?");
    expect(await alerts(page)).toMatchObject({ dings: 1, notifications: [], permissionRequests: 0 });
    await ion.close();
  });

  test("a refused prompt shows the hint at once", async ({ page }) => {
    await recordAlerts(page, "default", "denied");
    const live = await watchLiveConnection(page);
    await openLiveRoom(page, live);

    await bell(page, TURN_ON).click();
    await expect(panel(page).getByText(BLOCKED_HINT)).toBeVisible();
  });

  test("the choice survives a reload, and turning it off stops the alerts", async ({ page, context, browser, baseURL }) => {
    await recordAlerts(page, "granted");
    const live = await watchLiveConnection(page);
    const ion = await otherUser(browser, baseURL ?? "");
    const id = await openLiveRoom(page, live);
    await bell(page, TURN_ON).click();
    await page.goto("about:blank");

    // A new page in the same browser, as a reload is: the watcher could not tell a reloaded page's
    // channel from the old one, whose topic names repeat.
    const later = await context.newPage();
    await serveBlankTiles(later);
    await recordAlerts(later, "granted");
    const liveLater = await watchLiveConnection(later);
    await later.goto(`/?room=${id}`);
    await liveLater.ready(id);
    await bell(later, TURN_OFF).click();
    await expect(bell(later, TURN_ON)).toBeVisible();

    await ion.post(id, "Quiet now");
    await arrives(later, "Quiet now");
    expect((await alerts(later)).dings).toBe(0);
    await ion.close();
  });

  test("a room that does not exist has no bell", async ({ page }) => {
    await page.goto("/?room=00000000-0000-4000-8000-000000000000");
    await expect(panel(page)).toHaveText(/doesn't exist/);
    await expect(panel(page).getByRole("button", { name: TURN_ON })).toHaveCount(0);
  });
});

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 300, height: 310 },
]) {
  test.describe(`a phone, ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test("the bell sits in the sheet's header, beside Delete and Close, with nothing cut off", async ({ page }) => {
      await page.goto(`/?room=${await newRoom(page.request)}`);
      const bellBox = await bell(page, TURN_ON).boundingBox();
      const deleteBox = await panel(page).getByRole("button", { name: "Delete room" }).locator("visible=true").boundingBox();
      const closeBox = await panel(page).getByRole("button", { name: "Close chat" }).boundingBox();

      expect(bellBox!.y).toBe(closeBox!.y);
      expect(bellBox!.x + bellBox!.width).toBeLessThanOrEqual(deleteBox!.x);
      expect(deleteBox!.x + deleteBox!.width).toBeLessThanOrEqual(closeBox!.x);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    });
  });
}
