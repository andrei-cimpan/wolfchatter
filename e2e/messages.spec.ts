import type { APIRequestContext, Page } from "@playwright/test";
import { box, expect, serveBlankTiles, test } from "./support";

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

const panel = (page: Page) => page.getByRole("complementary", { name: "Chat" });
const messages = (page: Page) => panel(page).getByRole("log", { name: "Messages" });
const usernameField = (page: Page) => panel(page).getByRole("textbox", { name: "Username" });
const messageField = (page: Page) => panel(page).getByRole("textbox", { name: "Message" });
const submit = (page: Page) => panel(page).getByRole("button", { name: "Submit" });
const isMessagePost = (url: URL, method: string) => method === "POST" && url.pathname.endsWith("/messages");

async function newRoom(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/rooms", { data: { lat: 48, lng: 20 } });
  return ((await response.json()) as { id: string }).id;
}

async function openRoom(page: Page, id: string) {
  await page.goto(`/?room=${id}`);
  await expect(messages(page)).toBeVisible();
}

async function post(page: Page, author: string, body: string) {
  await usernameField(page).fill(author);
  await messageField(page).fill(body);
  await submit(page).click();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("a posted message appears with author, body and time; the username is kept", async ({ page }) => {
    await openRoom(page, await newRoom(page.request));
    await expect(messages(page)).toHaveText("No messages yet");

    await post(page, "ana", "Hello from the map");
    const item = messages(page).getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("ana:");
    await expect(item).toContainText("Hello from the map");
    await expect(item.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
    await expect(messageField(page)).toHaveValue("");
    await expect(messageField(page)).toBeFocused();
    await expect(usernameField(page)).toHaveValue("ana");

    await messageField(page).fill("Second");
    await messageField(page).press("Enter");
    await expect(messages(page).getByRole("listitem")).toHaveCount(2);
    await expect(messages(page).getByRole("listitem").last()).toContainText("Second");
  });

  test("an opened room shows the messages already in it, oldest first", async ({ page }) => {
    const id = await newRoom(page.request);
    for (const body of ["first", "second"]) {
      await page.request.post(`/api/rooms/${id}/messages`, { data: { author: "bo", body } });
    }
    await openRoom(page, id);
    await expect(messages(page).getByRole("listitem")).toHaveText([/first/, /second/]);
  });

  test("a message with nothing visible is not sent", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (isMessagePost(new URL(r.url()), r.method())) posts.push(r.url());
    });
    await openRoom(page, await newRoom(page.request));
    await post(page, "ana", "   ");
    await expect(panel(page).getByRole("alert")).toHaveText("Enter a message.");
    expect(posts).toHaveLength(0);
  });

  test("a rate-limited post explains the wait and keeps the text", async ({ page }) => {
    await page.route(
      (url) => url.pathname.endsWith("/messages"),
      (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 429,
              headers: { "Retry-After": "20" },
              json: { error: { code: "rate_limited", message: "Too many requests" } },
            })
          : route.fallback(),
    );
    await openRoom(page, await newRoom(page.request));
    await post(page, "ana", "Too fast");
    await expect(panel(page).getByRole("alert")).toHaveText(
      "You're sending messages too quickly. Try again in 20 seconds.",
    );
    await expect(messageField(page)).toHaveValue("Too fast");
    await expect(messages(page)).toHaveText("No messages yet");
  });

  test("the username carries over to another room; each room shows its own messages", async ({ page }) => {
    const first = await newRoom(page.request);
    const second = await newRoom(page.request);
    await openRoom(page, first);
    await post(page, "ana", "Only in the first room");
    await expect(messages(page)).toContainText("Only in the first room");

    // pushState, as a pin click does, so the panel stays mounted rather than reloading the page.
    await page.evaluate((id) => window.history.pushState(null, "", `/?room=${id}`), second);
    await expect(messages(page)).toHaveText("No messages yet");
    await expect(usernameField(page)).toHaveValue("ana");

    await page.goBack();
    await expect(messages(page)).toContainText("Only in the first room");
  });

  test("a long conversation scrolls inside the card and the form stays in view", async ({ page }) => {
    const id = await newRoom(page.request);
    for (let i = 1; i <= 25; i++) {
      await page.request.post(`/api/rooms/${id}/messages`, { data: { author: "bo", body: `Message ${i}` } });
    }
    await openRoom(page, id);
    await expect(messages(page).getByRole("listitem")).toHaveCount(25);

    const card = await box(page, "aside");
    expect(card.y + card.height).toBe(720 - 16);
    const button = await submit(page).boundingBox();
    expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(card.y + card.height);
    expect(await messages(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });
});

test.describe("narrow screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("posting works in the sheet, and the form stays at its bottom", async ({ page }) => {
    const id = await newRoom(page.request);
    for (let i = 1; i <= 15; i++) {
      await page.request.post(`/api/rooms/${id}/messages`, { data: { author: "bo", body: `Message ${i}` } });
    }
    await openRoom(page, id);
    await post(page, "ana", "From my phone");
    await expect(messages(page)).toContainText("From my phone");

    const sheet = await box(page, "aside");
    expect(sheet.y + sheet.height).toBe(667);
    for (const control of [usernameField(page), messageField(page), submit(page)]) {
      const b = await control.boundingBox();
      expect(b?.height).toBeGreaterThanOrEqual(44);
      expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(667);
    }
    expect(await messages(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });
});
