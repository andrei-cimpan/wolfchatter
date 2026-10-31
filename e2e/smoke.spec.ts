import { expect, test } from "@playwright/test";

// Placeholder until T3.1 replaces the default page; proves the e2e pipeline runs.
test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
