import { expect, test } from "../fixtures/auth";

test("completed fixture opens the protected planner", async ({ completedOnboardingPage: page }) => {
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
});

test("adds, edits, and deletes a household member without account deletion", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "家族を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await expect(page.getByRole("alert")).toContainText("年齢のめやすを選んでください");
  await expect(page.getByLabel("年齢のめやす")).toBeFocused();
  await page.getByRole("textbox", { name: "呼び名" }).fill("子ども");
  await page.getByLabel("年齢のめやす").selectOption("age_3_5");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "くるみを追加" }).click();
  await page.getByLabel("食べない食事はありますか").selectOption("none");
  await page.getByLabel("骨を除く").check();
  await page.getByLabel("食べる量").selectOption("small");
  await page.getByLabel("苦手食材を追加").fill("ねぎ");
  await page.getByRole("button", { name: "苦手食材を追加" }).click();
  await page.getByLabel("辛さ").selectOption("none");
  await page.getByRole("checkbox", { name: "小さめ" }).check();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  // プラン管理の surfaces-closed status と同居するため、文言で絞る
  await expect(
    page.getByRole("status").filter({ hasText: "最新条件で再確認します" }),
  ).toBeVisible();
  // 完了後は編集領域が閉じるため、一覧から再度開いて自由登録を続ける
  await page.getByRole("button", { name: "2人目の子どもを編集" }).click();
  await page.getByRole("textbox", { name: "自由登録名" }).fill("えんどう豆たんぱく");
  await page.getByLabel("一覧にないアレルギーとして登録").check();
  await page.getByRole("button", { name: "自由登録を追加" }).click();
  await page.getByRole("button", { name: "くるみを削除" }).click();
  await page.getByRole("button", { name: "家族を削除" }).click();
  await page.getByRole("button", { name: "家族だけを削除" }).click();
  // 一覧名と「編集中」見出しの両方に一致しうる getByText ではなく、編集ボタンの消滅で確認する
  await expect(page.getByRole("button", { name: "2人目の子どもを編集" })).toHaveCount(0);
  // 家族削除はアカウント削除と分離されていること（DangerZone のアカウント削除は残る）
  await expect(page.getByRole("region", { name: "危険な操作" })).toBeVisible();
  await expect(page.getByRole("button", { name: "アカウントを削除" })).toBeVisible();
  await expect(page.getByRole("button", { name: "家族を追加" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
