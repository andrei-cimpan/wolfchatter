import type { Browser, Page } from "@playwright/test";
import { PENDING_DRAFT_KEY } from "../src/lib/pending-draft";
import {
  DRAFT_TITLE,
  ROOM_URL,
  discard,
  draftPin,
  expectPosition,
  messageField,
  messages,
  openMap,
  panel,
  postedRoomPosition,
  roomTitle,
  startDraftAt,
  submit,
} from "./chat-page";
import { expect, serveBlankTiles, signInAs, TEST_AUTHOR, test, watchLiveConnection } from "./support";

const SIGNED_OUT_DRAFT_NOTE = "Sign in to create a chatroom here. Your pin stays where you dropped it.";
const SIGNED_OUT_ERROR = "You've been signed out. Signing in again clears this message, so copy it first.";

const signInToPost = (page: Page) => panel(page).getByRole("button", { name: "Sign in with Google to post" });
const signIn = (page: Page) => panel(page).getByRole("button", { name: "Sign in with Google", exact: true });
const signOut = (page: Page) => panel(page).getByRole("button", { name: "Sign out" });
const postingAs = (page: Page) => panel(page).getByText(`Posting as ${TEST_AUTHOR}`);

test.beforeEach(async ({ page }) => {
  await serveBlankTiles(page);
});

/** A room with one message, made by another signed-in user, for pages that are signed out. */
async function roomByAnotherUser(browser: Browser, baseURL: string, body = "Hello from Ana"): Promise<string> {
  const context = await browser.newContext({ baseURL });
  try {
    await signInAs(context, baseURL);
    const room = await context.request.post("/api/rooms", { data: { lat: 48, lng: 20, firstMessage: { body } } });
    expect(room.status()).toBe(201);
    return ((await room.json()) as { id: string }).id;
  } finally {
    await context.close();
  }
}

test.describe("signed out", () => {
  test.use({ signedIn: false, viewport: { width: 1280, height: 720 } });

  test("a room's messages can be read, and sign-in replaces the form", async ({ page, browser, baseURL }) => {
    const id = await roomByAnotherUser(browser, baseURL ?? "");
    await page.goto(`/?room=${id}`);
    await expect(messages(page)).toContainText(`${TEST_AUTHOR}:`);
    await expect(messages(page)).toContainText("Hello from Ana");
    await expect(signInToPost(page)).toBeVisible();
    await expect(messageField(page)).toHaveCount(0);
  });

  test("clicking the map drops the pin and asks to sign in to create the room", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 500, 300);
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await expect(panel(page).getByRole("status")).toHaveText(SIGNED_OUT_DRAFT_NOTE);
    await expect(signIn(page)).toBeVisible();
    await expect(discard(page)).toBeVisible();
    await expect(draftPin(page)).toBeVisible();
    await expect(messageField(page)).toHaveCount(0);
  });

  test("Sign in with Google goes to Google through Supabase, returning to the same room", async ({
    page,
    browser,
    baseURL,
  }) => {
    const id = await roomByAnotherUser(browser, baseURL ?? "");
    let authorize: URL | undefined;
    // Not followed: Google's page cannot be automated, and the test must stay offline.
    await page.route("**/auth/v1/authorize**", (route) => {
      authorize = new URL(route.request().url());
      return route.fulfill({ status: 200, body: "stopped before Google" });
    });
    await page.goto(`/?room=${id}`);
    await signInToPost(page).click();
    await expect.poll(() => authorize?.searchParams.get("provider")).toBe("google");
    const redirectTo = new URL(authorize?.searchParams.get("redirect_to") ?? "");
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe(`/?room=${id}`);
  });

  test("a reader who is signed out sees a message from a signed-in writer live", async ({
    page,
    browser,
    baseURL,
  }) => {
    const id = await roomByAnotherUser(browser, baseURL ?? "", "First");
    const live = await watchLiveConnection(page);
    await page.goto(`/?room=${id}`);
    await live.ready(id);

    const writer = await browser.newContext({ baseURL });
    try {
      await signInAs(writer, baseURL ?? "");
      await writer.request.post(`/api/rooms/${id}/messages`, { data: { body: "Live, from a signed-in writer" } });
    } finally {
      await writer.close();
    }
    await expect(messages(page).getByRole("listitem")).toHaveText([/First/, /Live, from a signed-in writer/]);
  });
});

test.describe("signed in", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the card shows who is posting, with no username field, and a post carries that name", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 500, 300);
    await expect(postingAs(page)).toBeVisible();
    await expect(signOut(page)).toBeVisible();
    await expect(panel(page).getByRole("textbox", { name: "Username" })).toHaveCount(0);

    await messageField(page).fill("Signed and sent");
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(messages(page).getByRole("listitem")).toHaveText([new RegExp(`${TEST_AUTHOR}:[\\s\\S]*Signed and sent`)]);
    await expect(postingAs(page)).toBeVisible();
  });

  test("signing out brings back the sign-in prompt without a reload", async ({ page }) => {
    await openMap(page);
    await startDraftAt(page, 500, 300);
    await messageField(page).fill("A room to come back to");
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);
    const loads: string[] = [];
    page.on("load", () => loads.push(page.url()));

    await signOut(page).click();
    await expect(signInToPost(page)).toBeVisible();
    await expect(messageField(page)).toHaveCount(0);
    await expect(messages(page)).toContainText("A room to come back to");
    expect(loads).toEqual([]);
  });

  test("a reload keeps the session", async ({ page }) => {
    await openMap(page);
    await expect(page.getByText(/Click on the map/)).toBeVisible();
    await startDraftAt(page, 500, 300);
    await expect(postingAs(page)).toBeVisible();
    await page.reload();
    await startDraftAt(page, 500, 300);
    await expect(postingAs(page)).toBeVisible();
  });

  test("returning from sign-in restores the draft pin once, where it was dropped", async ({ page }) => {
    await openMap(page);
    // What signInWithGoogle leaves behind before the page goes to Google.
    await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
      key: PENDING_DRAFT_KEY,
      value: JSON.stringify({ lat: 47.5, lng: 21 }),
    });
    await page.reload();
    await expect(roomTitle(page)).toHaveText(DRAFT_TITLE);
    await expect(draftPin(page)).toBeVisible();

    const posted = postedRoomPosition(page);
    await messageField(page).fill("Back from Google");
    await submit(page).click();
    expectPosition(await posted, { lat: 47.5, lng: 21 });
    await expect(page).toHaveURL(ROOM_URL);

    await page.goto("/");
    await expect(panel(page)).toHaveText(/Click on the map to start a chat/);
    await expect(draftPin(page)).toHaveCount(0);
  });

  test("a session that ends mid-use keeps the typed text and says why the post failed", async ({ page, context }) => {
    await openMap(page);
    await startDraftAt(page, 500, 300);
    await messageField(page).fill("Opening line");
    await submit(page).click();
    await expect(page).toHaveURL(ROOM_URL);

    await messageField(page).fill("Worth keeping");
    await context.clearCookies();
    await submit(page).click();
    await expect(panel(page).getByRole("alert")).toHaveText(SIGNED_OUT_ERROR);
    await expect(messageField(page)).toHaveValue("Worth keeping");
    await expect(signIn(page)).toBeVisible();
    await expect(messages(page).getByRole("listitem")).toHaveCount(1);
  });
});
