import { expect, test } from "../fixtures/auth";
import type { Page } from "@playwright/test";

// --- 献立生成の復旧・結果表示E2Eテスト ---
// 切断復旧、タブ再開、結果画面の詳細表示、320px幅でのレイアウトを検証する。
// NOTE: 結果画面（/menus/:menuId）のルート結線はTask 15で追加される。
// ルート不在時はこれらのテストは通らない。

async function completeMinimumPlanner(page: Page) {
  await page.goto("/planner");
  await page.getByRole("radio", { name: "夕食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("radio", { name: "和食" }).check();
  // 自動保存が完了し献立生成ボタンが有効になるまで待つ
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({
    timeout: 10_000,
  });
}

test("resends the same key after the first POST is lost before acceptance", async ({
  completedOnboardingPage: page,
}) => {
  await completeMinimumPlanner(page);
  const postedKeys: string[] = [];
  let firstAborted: (() => void) | undefined;
  const firstAbortedPromise = new Promise<void>((resolve) => {
    firstAborted = resolve;
  });
  let first = true;
  await page.route("**/api/generations/menu", async (route) => {
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    postedKeys.push(body.idempotencyKey);
    if (first) {
      first = false;
      await route.abort("connectionreset");
      firstAborted?.();
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  // 最初のPOST abortが完了し、pending generationがlocalStorageに保存されるのを待つ
  await firstAbortedPromise;
  await page.reload();
  // recovery hookがGET statusでsucceeded結果を検出し、結果画面へ遷移する
  await expect(page.getByText("献立ができました")).toBeVisible({ timeout: 30_000 });
  expect(new Set(postedKeys).size).toBe(1);
});

test("recovers a persisted result when only the POST response is lost", async ({
  completedOnboardingPage: page,
}) => {
  await completeMinimumPlanner(page);
  let fetchCompleted: (() => void) | undefined;
  const fetchCompletedPromise = new Promise<void>((resolve) => {
    fetchCompleted = resolve;
  });
  let intercepted = false;
  await page.route("**/api/generations/menu", async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    // サーバー側の処理を完了させる（DBに結果が保存される）
    await route.fetch();
    fetchCompleted?.();
    // レスポンスだけを破棄する
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  // サーバー側の処理完了（結果永続化）を待ってからreloadする
  await fetchCompletedPromise;
  await page.reload();
  // recovery hookがGET statusでsucceeded結果を取得し、結果画面を表示する
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
  // POSTレスポンスを遅延させて、クライアントがprocessing状態を認識する時間を確保する
  let releaseResponse: (() => void) | undefined;
  await page.route("**/api/generations/menu", async (route) => {
    const response = await route.fetch();
    // レスポンスを保持し、テストがタブを閉じた後に解放する
    await new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  // POSTが発行されたことを確認（クライアント側ではsubmitting/processing状態）
  await expect(page.getByText("献立を作っています")).toBeVisible({ timeout: 10_000 });
  await page.close();
  // サーバー側は既に処理完了（route.fetch()で完了済み）なので、レスポンスを解放
  releaseResponse?.();
  // 新しいタブでplannerを開き、recovery hookがGET statusで結果を取得する
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
  // AI免責の冒頭文
  await expect(page.getByText("AIが作成した献立です。")).toBeVisible();
  // 段取りセクション — mock success fixture の timeline 内容を確認
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  await expect(page.getByText("主菜の材料を切って加熱を始める")).toBeVisible();
  await expect(page.getByText("主菜を煮ながら副菜を仕上げる")).toBeVisible();
  // ラベル確認セクション — mock success fixture は ingredient_2「しょうゆ」に
  // wheat アレルゲンの label confirmation を持つ
  await expect(page.getByText("加工品は原材料表示を確認してください")).toBeVisible();
  await expect(page.getByText("しょうゆ")).toBeVisible();
  // 料理タブ — 2品目「にんじんの温サラダ」が存在する
  await expect(page.getByRole("tablist", { name: "料理" })).toBeVisible();
  await page.getByRole("tab").nth(1).click();
  // 材料・作り方見出し
  await expect(page.getByRole("heading", { name: "材料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "作り方" })).toBeVisible();
  // 1番目の料理の取り分けセクション — mock success fixture の adaptation
  // portionText: "1人分", safetyActions[0].instruction: "骨を完全に除く"
  await page.getByRole("tab").first().click();
  await expect(page.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
  await expect(page.getByText("骨を完全に除く")).toBeVisible();
  // 冷蔵庫食材セクション — mock success fixture の pantryUsage は空なので
  // 空状態メッセージまたはセクション見出しの存在を確認
  await expect(page.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  // 免責文全文
  await expect(page.getByText("安全を保証する表示ではありません")).toBeVisible();
  // 横スクロールが発生しないことを確認
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
