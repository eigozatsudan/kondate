import { expect, requestMagicLinkAndReadUrl, test } from "../fixtures/auth";

test("same-browser callback restores both callback and original tabs", async ({
  page,
  context,
  authEmail,
}) => {
  const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
  const callbackTab = await context.newPage();
  await callbackTab.goto(magicLink);
  await expect(callbackTab.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
  await page.bringToFront();
  await expect(page).toHaveURL(/\/planner$/u);
});

test("isolated WebView deposits once and the original browser claims with its secret", async ({
  page,
  browser,
  authEmail,
}) => {
  const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
  const isolated = await browser.newContext();
  const webView = await isolated.newPage();
  await webView.goto(magicLink);
  await expect(
    webView.getByText("元のブラウザでログインを続けてください。この画面に認証情報は保存されません"),
  ).toBeVisible();
  await page.bringToFront();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(webView).not.toHaveURL(/\/planner$/u);
  await isolated.close();
});

test("Google cancel and expired links return actionable login choices", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied&returnTo=%2Fplanner");
  await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible();
  await page.goto(
    "/auth/callback?error=access_denied&error_code=otp_expired&flow=expired&returnTo=%2Fplanner",
  );
  await expect(page.getByText(/期限切れか、すでに使用/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();
});
