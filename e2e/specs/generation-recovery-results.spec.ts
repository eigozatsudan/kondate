import { expect, test } from "../fixtures/auth";
import type { Page, Request, Route } from "@playwright/test";

// --- 献立生成の復旧・結果表示E2Eテスト ---
// 切断復旧、タブ再開、結果画面（/menus/:menuId）の詳細表示、320px幅でのレイアウトを検証する。

async function completeMinimumPlanner(page: Page) {
  // local OpenRouterの固定success fixtureと同じ家族・食事条件に揃え、
  // E2EがAI応答fixtureの内容ではなく復旧flowだけを検証できるようにする。
  await page.goto("/settings");
  await page.getByLabel("呼び名").fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await page.goto("/planner");
  await page.getByRole("radio", { name: "朝食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("radio", { name: "和食" }).check();
  // draftRevisionがserver側で確定する前のPOSTを避けるため、自動保存完了を待つ。
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible({ timeout: 10_000 });
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
  // POSTは2回発行され（初回abort後の再送1回）、両方とも同一idempotencyKeyであることを
  // 直接確認する。Set.size === 1 だけではPOSTが1回だけでも通過してしまうため、
  // 実際に2回のPOSTが発生し、両方が同じkeyであることを明示的に検証する。
  expect(postedKeys.length).toBe(2);
  expect(postedKeys[0]).toBe(postedKeys[1]);
});

test("recovers a persisted result when only the POST response is lost", async ({
  completedOnboardingPage: page,
  context,
}) => {
  await completeMinimumPlanner(page);
  let generationPostCount = 0;
  const countGenerationPost = (request: Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/generations/menu"
    ) {
      generationPostCount += 1;
    }
  };
  const generationPostPattern = "**/api/generations/menu";
  const generationStatusPattern = "**/api/generations/*/status";
  const dropPostResponse = async (route: Route) => {
    // E2E Function Serverにhandler完了後のresponseだけを破棄させる。
    // browser側でabortしないため、生成結果のDB永続化は確実に完了する。
    await route.continue({
      headers: {
        ...route.request().headers(),
        "X-Kondate-E2E-Drop-Response": "after-handler",
      },
    });
  };
  const dropStatusResponse = async (route: Route) => {
    // 永続化直後のstatus成功で結果画面へ先行遷移しないよう、このtestだけ
    // recovery GETを切断し、POST応答喪失時のoffline表示を確実に観測する。
    await route.abort("connectionreset");
  };
  await page.route(generationPostPattern, dropPostResponse);
  await page.route(generationStatusPattern, dropStatusResponse);
  context.on("request", countGenerationPost);
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page.getByText("通信を確認しています")).toBeVisible({ timeout: 10_000 });
  // 他のfixture routeを維持したまま、ここで追加したfault handlerだけを解除する。
  await page.unroute(generationPostPattern, dropPostResponse);
  await page.unroute(generationStatusPattern, dropStatusResponse);
  await page.reload();
  // recovery hookがGET statusでsucceeded結果を取得し、結果画面を表示する
  try {
    await expect(page).toHaveURL(/\/menus\/[0-9a-f-]+\?recovered=1$/);
    // reload後の誤ったnot_started判定が同じkeyを再POSTしてもserverの冪等性で
    // 成功し得るため、結果表示より先にcontext全体のPOST総数を直接検証する。
    expect(generationPostCount).toBe(1);
  } finally {
    context.off("request", countGenerationPost);
  }
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "料理" })).toBeVisible();
});

test("recovers a completed result after a tab is closed before its POST response arrives", async ({
  completedOnboardingPage: page,
  context,
}) => {
  await completeMinimumPlanner(page);
  let generationPostCount = 0;
  const countGenerationPost = (request: Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/generations/menu"
    ) {
      generationPostCount += 1;
    }
  };
  await page.route("**/api/generations/*/status", async (route) => {
    // handler完了後もstatus応答を切断し、元tabが結果を回収する前に
    // POST応答喪失時のoffline表示を同期点として観測できるようにする。
    await route.abort("connectionreset");
  });
  await page.route("**/api/generations/menu", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "X-Kondate-E2E-Drop-Response": "after-handler",
      },
    });
  });
  context.on("request", countGenerationPost);
  await page.getByRole("button", { name: "献立を作る" }).click();
  // after-handlerでgenerationの永続化を完了し、POSTとstatusの両応答喪失を
  // clientが認識した時点を条件同期にする。固定時間待ちは使わない。
  await expect(page.getByText("通信を確認しています")).toBeVisible({ timeout: 10_000 });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/generation");
  try {
    await expect(reopened).toHaveURL(/\/menus\/[0-9a-f-]+\?recovered=1$/);
    // 新しいpageで誤ったnot_started判定から再送しても同じ結果へ回復できるため、
    // page closeをまたぐcontext全体のPOST総数が1回だけであることを保証する。
    expect(generationPostCount).toBe(1);
  } finally {
    context.off("request", countGenerationPost);
  }
  await expect(reopened.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
});

test("shows timeline, tabs, ingredients, steps, adaptations, empty pantry state, labels, and disclaimer at 320px", async ({
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
  await expect(page.getByText("しょうゆ：小麦")).toBeVisible();
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
  // 明示的な空状態メッセージを確認する（テスト名の pantry reasons は success
  // fixture では非空にならないため、この空状態表示自体が検証対象）
  await expect(page.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  await expect(page.getByText("今回選んだ冷蔵庫食材はありません。")).toBeVisible();
  // 免責文全文（menu-result.tsx の実際の固定文言）
  await expect(
    page.getByText(
      "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。",
    ),
  ).toBeVisible();
  // 横スクロールが発生しないことを確認
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
