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
  await expect(page.getByRole("alert")).toContainText("年齢区分を選んでください");
  await expect(page.getByLabel("年齢区分")).toBeFocused();
  await page.getByLabel("呼び名").fill("子ども");
  await page.getByLabel("年齢区分").selectOption("age_3_5");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "くるみを追加" }).click();
  await page.getByLabel("対象外の食事の確認").selectOption("none");
  await page.getByLabel("骨を除く").check();
  await page.getByLabel("食べる量").selectOption("small");
  await page.getByLabel("苦手食材を追加").fill("ねぎ");
  await page.getByRole("button", { name: "苦手食材を追加" }).click();
  await page.getByLabel("辛さ").selectOption("none");
  await page.getByRole("checkbox", { name: "小さめ" }).check();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await expect(page.getByRole("status")).toContainText("最新条件で再確認します");
  await page.getByLabel("自由登録名").fill("えんどう豆たんぱく");
  await page.getByLabel("標準候補に該当しないことを確認").check();
  await page.getByRole("button", { name: "自由登録を追加" }).click();
  await page.getByRole("button", { name: "くるみを削除" }).click();
  await page.getByRole("button", { name: "家族を削除" }).click();
  await page.getByRole("button", { name: "家族だけを削除" }).click();
  await expect(page.getByText("子ども")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "アカウントを削除" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
