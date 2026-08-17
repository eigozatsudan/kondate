import { expect, test } from "@playwright/test";

test("unauthenticated home shows the free landing and hides static SEO copy", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "今日の献立、家族に合わせて。" }),
  ).toBeVisible();
  const staticLp = page.locator("#kondate-public-lp");
  await expect(staticLp).toHaveCount(1);
  await expect(staticLp).not.toBeVisible();
  await page.getByRole("link", { name: "無料ではじめる" }).first().click();
  await expect(page).toHaveURL(/\/login(\?|$)/u);
});
