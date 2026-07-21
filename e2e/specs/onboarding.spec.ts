import { expect, test } from "../fixtures/auth";

test("resumes a partially saved member and records privacy consent", async ({
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
  await page.getByRole("button", { name: "AI情報の説明へ" }).click();
  await expect(page.getByRole("heading", { name: "AIへ送る情報" })).toBeVisible();
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
});
