import { expect, test } from "../fixtures/auth";
import type { Page } from "@playwright/test";

// --- 献立生成の復旧・結果表示E2Eテスト ---
// 切断復旧、タブ再開、結果画面の詳細表示、320px幅でのレイアウトを検証する。

async function completeMinimumPlanner(page: Page) {
  await page.goto("/planner");
  await page.getByRole("radio", { name: "夕食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("radio", { name: "和食" }).check();
  // 自動保存完了とボタン有効化を待つ
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({
    timeout: 10_000,
  });
}

test("resends the same key after the first POST is lost before acceptance", async ({
  completedOnboardingPage: page,
}) => {
  await completeMinimumPlanner(page);
  let first = true;
  const postedKeys: string[] = [];
  await page.route("**/api/generations/menu", async (route) => {
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    postedKeys.push(body.idempotencyKey);
    if (first) {
      first = false;
      await route.abort("connectionreset");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await page.reload();
  await expect(page.getByText("献立ができました")).toBeVisible({ timeout: 30_000 });
  expect(new Set(postedKeys).size).toBe(1);
});

test("recovers a persisted result when only the POST response is lost", async ({
  completedOnboardingPage: page,
}) => {
  await completeMinimumPlanner(page);
  let intercepted = false;
  await page.route("**/api/generations/menu", async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "料理" })).toBeVisible();
});

test("recovers processing after closing and reopening a tab", async ({
  completedOnboardingPage: page,
  context,
}) => {
  await completeMinimumPlanner(page);
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page.getByText("献立を作っています")).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/planner");
  await expect(reopened.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
});

test("shows timeline, tabs, ingredients, steps, adaptations, pantry reasons, labels, and disclaimer at 320px", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await completeMinimumPlanner(page);
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("AIが作成した献立です。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  await expect(page.getByText("加工品は原材料表示を確認してください")).toBeVisible();
  await page.getByRole("tab").nth(1).click();
  await expect(page.getByRole("heading", { name: "材料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "作り方" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
