import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";

async function savePlannerMeal(page: Page, mealName: "朝食" | "昼食" | "夕食"): Promise<void> {
  await page.goto("/planner");
  await page.getByRole("radio", { name: mealName }).check();
  await expect(page.getByText("保存中…")).toBeVisible();
  await expect(page.getByText("保存済み")).toBeVisible();
}

async function expectCompleteCandidate(
  page: Page,
  input: { heading: string; firstDish: string; ingredient: string; quantity: string },
): Promise<void> {
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  await expect(page.getByRole("heading", { name: input.heading })).toBeVisible();
  await expect(page.getByText("AI利用回数は消費しません。")).toBeVisible();
  await expect(page.getByText("食卓まで全体 15分・2人分")).toBeVisible();
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  await expect(page.getByRole("heading", { name: input.firstDish })).toBeVisible();
  await expect(page.getByText(input.ingredient, { exact: true })).toBeVisible();
  await expect(page.getByText(input.quantity, { exact: true })).toBeVisible();
  await expect(page.getByText(/手順1/u).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  await expect(page.getByText(/安全を保証する表示ではありません/u)).toBeVisible();
}

test("pantry CRUD, restored planner, attempt-local expiry check, and all reviewed meals", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });

  await page.goto("/pantry");
  await page.getByLabel("食材名").fill("キャベツ");
  await page.getByLabel("分量").fill("1");
  await page.getByLabel("単位").fill("個");
  await page.getByLabel("期限日").fill("2000-01-01");
  await page.getByLabel("期限の種類").selectOption("use_by");
  await page.getByLabel("開封状態").selectOption("opened");
  await page.getByRole("button", { name: "追加する" }).click();
  await expect(page.getByRole("heading", { name: "キャベツ", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "キャベツを編集" }).click();
  await page.getByLabel("分量").fill("2");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("2個", { exact: true })).toBeVisible();

  await page.goto("/planner");
  await expect(page.getByText("現在の家族・安全条件")).toBeVisible();
  await page.getByRole("radio", { name: "夕食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("radio", { name: "和食" }).check();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toContainText("アプリは食べられるか判断しません");
  await page.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }).click();
  await page.getByLabel("キャベツの使い方").selectOption("must_use");
  await expect(page.getByText("保存中…")).toBeVisible();
  await expect(page.getByText("保存済み")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("radio", { name: "夕食" })).toBeChecked();
  await expect(page.getByText("鶏肉を外す")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).toBeChecked();
  await expect(page.getByLabel("キャベツの使い方")).toHaveValue("must_use");
  await page.getByRole("checkbox", { name: "キャベツ" }).uncheck();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }).click();
  await page.getByLabel("キャベツの使い方").selectOption("must_use");
  await expect(page.getByText("保存中…")).toBeVisible();
  await expect(page.getByText("保存済み")).toBeVisible();

  await expectCompleteCandidate(page, {
    heading: "鶏肉とキャベツの塩蒸し・きゅうりの塩もみ・玉ねぎの塩スープ",
    firstDish: "主菜・鶏肉とキャベツの塩蒸し",
    ingredient: "鶏肉",
    quantity: "250g",
  });
  const details = page.locator("article details").first();
  const summary = details.locator("summary", { hasText: "材料と作り方を表示" });
  await summary.focus();
  await summary.press("Enter");
  await expect(details).not.toHaveAttribute("open", "");
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  const renderedText = await page.locator("body").innerText();
  expect(renderedText).not.toContain("member_1");
  expect(renderedText).not.toContain("dishes.0.ingredients.0.name");
  expect(renderedText).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await savePlannerMeal(page, "朝食");
  await expectCompleteCandidate(page, {
    heading: "鮭おにぎり・やわらか野菜",
    firstDish: "主菜・鮭おにぎり",
    ingredient: "鮭",
    quantity: "1切れ",
  });

  await savePlannerMeal(page, "昼食");
  await expectCompleteCandidate(page, {
    heading: "鶏そぼろ丼・やわらか温野菜",
    firstDish: "主菜・鶏そぼろ丼",
    ingredient: "鶏ひき肉",
    quantity: "200g",
  });

  await page.goto("/pantry");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "キャベツを削除" }).click();
  await expect(page.getByRole("heading", { name: "キャベツ", exact: true })).toHaveCount(0);
  await page.goto("/planner");
  await expect(page.getByRole("alert")).toContainText("冷蔵庫から削除された食材");
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeDisabled();
});

test("keeps an incompatible current allergy as an explicit no-candidate result", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/settings");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "鶏肉を追加" }).click();
  await expect(page.getByRole("status")).toContainText("最新条件で再確認します");
  await page.goto("/planner");
  await page.getByRole("radio", { name: "夕食" }).check();
  await expect(page.getByText("保存中…")).toBeVisible();
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  await expect(page.getByText("条件に合う緊急献立がありません")).toBeVisible();
  await expect(page.getByText("条件を緩めず、候補を表示していません。")).toBeVisible();
  await expect(page.getByText(/条件を緩め/u)).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
