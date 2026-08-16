import { devices } from "@playwright/test";
import { expect, loginAsNewUser, test } from "../fixtures/auth";

test.use({ ...devices["iPhone SE"] });

test("shows the iPhone install card, dismisses it, and keeps the settings section", async ({
  page,
  authEmail,
}) => {
  await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
  await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
  await page.getByRole("button", { name: "わかりました" }).click();
  await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "ホーム画面に追加" })).toBeVisible();
});

test("shows Android install steps under an Android UA", async ({ browser, authEmail }) => {
  const context = await browser.newContext({
    ...devices["Pixel 5"],
  });
  const page = await context.newPage();
  await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
  await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
  await expect(page.getByText("右上のメニューを開きます")).toBeVisible();
  await context.close();
});
