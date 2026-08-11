import { expect, requestMagicLinkAndReadUrl, test } from "../fixtures/auth";

test(
  "same-browser callback restores both callback and original tabs",
  {
    tag: ["@smoke"],
  },
  async ({ page, context, authEmail }) => {
    const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
    const callbackTab = await context.newPage();
    await callbackTab.goto(magicLink);
    // 同一ブラウザ callback→session は mobile / 並列負荷で 5s 既定を超え得る
    // （fixtures/auth.ts の generateLink 着地と同型で 30s）。
    await expect(callbackTab.getByRole("navigation", { name: "メインメニュー" })).toBeVisible({
      timeout: 30_000,
    });
    await page.bringToFront();
    await expect(page).toHaveURL(/\/planner$/u, { timeout: 30_000 });
  },
);

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
    webView.getByText(
      "元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await page.bringToFront();
  // 元タブの recovery claim は mobile / 並列負荷で 5s 既定を超え得る
  await expect(page).toHaveURL(/\/planner$/u, { timeout: 30_000 });
  await expect(webView).not.toHaveURL(/\/planner$/u);
  await isolated.close();
});

test("Google cancel and expired links return actionable login choices", async ({ page }) => {
  // C7: callback 許可クエリに returnTo は無い（unknown key → unbound_callback）。
  // returnTo は stored flow 由来。error 系は flow 無しでも oauth_cancelled / expired へ写る。
  await page.goto("/auth/callback?error=access_denied");
  await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible();
  await page.goto("/auth/callback?error=access_denied&error_code=otp_expired");
  await expect(page.getByText(/期限切れか、すでに使用/u)).toBeVisible();
  // expired 状態の CTA（idle の「Googleで続ける」「ログイン用メールを送る」ではない）。
  // 直前にメール未送信だと宛先が空で「メールアドレスを入力して再送」になる。
  await expect(page.getByRole("button", { name: "Googleに切り替える" })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /ログイン用メールを再送|メールアドレスを入力して再送|秒後に再送/u,
    }),
  ).toBeVisible();
});
