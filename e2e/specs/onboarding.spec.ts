import { expect, test } from "../fixtures/auth";
import { confirmAddScopeNotice } from "../fixtures/household";

test("resumes a partially saved member, shows next-action after complete, then reaches /planner without privacy consent", async ({
  authenticatedPage: page,
}) => {
  // 新規利用者はログイン直後に/welcomeへ着地する。
  // 家族導線を選んでから/onboardingへ進む。
  await page.getByRole("button", { name: "家族情報を登録する" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/onboarding");
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await confirmAddScopeNotice(page);
  await page.getByLabel("年齢のめやす").selectOption("adult");
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("年齢のめやす")).toHaveValue("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel(/このアプリで献立を作れない事情はありますか/).selectOption("none");

  await expect(page.getByText("まずは1人分から登録しましょう")).toBeVisible();

  await page.getByRole("button", { name: "この家族の設定を完了する" }).click();

  // 次アクション: まだ planner に行かない
  await expect(page).toHaveURL((url) => url.pathname === "/onboarding");
  await expect(page.getByRole("heading", { name: "1人目の登録が完了しました" })).toBeVisible();
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
  await expect(page.getByRole("button", { name: "献立を始める" })).toBeVisible();
  await expect(page.getByRole("button", { name: "続けて家族を追加" })).toBeVisible();

  await page.getByRole("button", { name: "献立を始める" }).click();

  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  await page.goto("/privacy?returnTo=%2Fplanner");
  // 未チェックでも primary は有効。押下で理由を role=alert 案内する（disabled 無反応 UX を避ける）。
  const confirmButton = page.getByRole("button", { name: "確認して進む" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByRole("alert")).toContainText("説明を確認しました");
  // 共有同意は任意カード: 既定 checked。外さなくても privacy 同意だけで生成導線へ戻れる。
  const shareCheckbox = page.getByRole("checkbox", { name: "匿名で緊急候補に役立ててよい" });
  await expect(page.getByRole("heading", { name: "匿名の緊急候補への協力（任意）" })).toBeVisible();
  await expect(shareCheckbox).toBeVisible();
  await expect(shareCheckbox).toBeChecked();
  await expect(
    page.getByText("最初からチェックが入っています。不要なら外してください。"),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  // complete 再訪: 人数行 + skip 非表示
  await page.goto("/onboarding");
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  ).toHaveCount(0);
});
