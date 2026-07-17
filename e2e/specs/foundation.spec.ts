import { expect, test } from "@playwright/test";

test("protects app routes and fits the active viewport", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/pantry");
  await expect(page.getByRole("heading", { name: "こんだて日和" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/login");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  for (const button of await page.getByRole("button").all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(pageErrors).toEqual([]);
});
