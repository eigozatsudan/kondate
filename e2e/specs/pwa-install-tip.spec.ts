import { devices } from "@playwright/test";
import { expect, loginAsNewUser, test } from "../fixtures/auth";

// devices["iPhone SE"] は defaultBrowserType: webkit。desktop-chromium が
// WebKit バイナリを探すのを防ぐため、UA / viewport は残して browserName だけ上書きする。
// mobile 専用。desktop 二重実行は config の grepInvert で除外する。
test.use({ ...devices["iPhone SE"], browserName: "chromium" });

test(
  "shows the iPhone install card, dismisses it, and keeps the settings section",
  { tag: ["@mobile-only"] },
  async ({ page, authEmail }) => {
    await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    await page.getByRole("button", { name: "わかりました" }).click();
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "ホーム画面に追加" })).toBeVisible();
  },
);

test(
  "shows Android install steps under an Android UA",
  { tag: ["@mobile-only"] },
  async ({ browser, authEmail }) => {
    // Pixel 5 の UA / viewport。親 browser は上の chromium 指定に従う。
    const context = await browser.newContext({
      ...devices["Pixel 5"],
    });
    const page = await context.newPage();
    await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    await expect(page.getByText("右上のメニューを開きます")).toBeVisible();
    await context.close();
  },
);
