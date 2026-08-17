import { devices } from "@playwright/test";
import { expect, loginAsNewUser, test } from "../fixtures/auth";

test.use({ ...devices["iPhone SE"], browserName: "chromium" });

test(
  "shows the iPhone install card, dismisses it, and keeps the settings section",
  { tag: ["@mobile-only"] },
  async ({ page, authEmail }) => {
    await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: "共有", exact: true })).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: "ホーム画面に追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listitem", { name: "追加", exact: true })).toBeVisible();
    await expect(page.locator("svg[aria-hidden='true'][data-icon]")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.getByRole("button", { name: "わかりました" }).click();
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toHaveCount(0);

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "ホーム画面に追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listitem", { name: "共有", exact: true })).toBeVisible();
  },
);

test(
  "shows Android install steps under an Android UA",
  { tag: ["@mobile-only"] },
  async ({ browser, authEmail }) => {
    const context = await browser.newContext({
      ...devices["Pixel 5"],
    });
    const page = await context.newPage();
    await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: "メニュー", exact: true })).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: "ホーム画面に追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("右上のメニューを開きます")).toHaveCount(0);
    await context.close();
  },
);
