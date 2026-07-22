import { expect, test } from "../fixtures/auth";

test("resumes a partially saved member, completes household setup directly to /planner without privacy consent, then saves consent independently", async ({
  authenticatedPage: page,
}) => {
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await page.getByLabel("年齢のめやす").selectOption("adult");
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("年齢のめやす")).toHaveValue("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel("食べない食事はありますか").selectOption("none");
  await page.getByRole("button", { name: "残りはあとで設定して完了" }).click();

  // 家族設定完了はAI利用同意を一切経由せず/plannerへ直接遷移する。この時点では
  // まだ同意画面を一度も開いていない(=同意は保存されていない)。
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  // /privacyを独立して開いて同意を保存する。
  await page.goto("/privacy?returnTo=%2Fplanner");
  await expect(page.getByRole("button", { name: "確認して進む" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  // /onboardingへ戻ってもcompleteのままretreatしないことを確認する。
  await page.goto("/onboarding");
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
});
