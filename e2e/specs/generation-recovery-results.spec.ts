import { expect, test } from "../fixtures/auth";
import { z } from "zod";
import {
  clickWizardNext,
  expectIdeaResultSurface,
  openAndAssertIdeaSafetyDetails,
  openFirstMemberEditor,
  openWizardFromHome,
  selectHouseholdAudienceWithMember,
  setMockScenario,
} from "../fixtures/history";
import { localRestHeaders } from "../fixtures/local-supabase";
import type { Locator, Page, Request, Route } from "@playwright/test";

// --- 献立生成の復旧・結果表示E2Eテスト ---
// 切断復旧、タブ再開、結果画面（/menus/:menuId）の詳細表示、320px幅でのレイアウトを検証する。

/**
 * welcomeから「家族設定を省略」してideaモードで4質問→人数N→privacy→reviewへ進める。
 * PlannerWizardは1画面1質問（meal→ingredients→cuisine→audience→review）のため、
 * 旧PlannerForm（同一画面で全条件をradio選択）とは操作手順が異なる。
 */
async function completeIdeaPlannerToReview(page: Page, servings: number): Promise<void> {
  // ログイン直後の/welcomeで家族設定を省略し、idea専用のonboarding_status=skippedへ進む。
  await expect(page).toHaveURL((url) => url.pathname === "/welcome");
  await page.getByRole("button", { name: "献立アイデアを考える" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/planner");
  // Phase 4: 素の /planner はホーム。ウィザードへ主 CTA で入る。
  await page.getByRole("button", { name: "今日の献立をつくる" }).click();

  // 1. 食事
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
  const mealSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );
  await page.getByRole("radio", { name: "朝食" }).check();
  expect((await mealSaveResponse).ok()).toBe(true);
  await clickWizardNext(page);

  // 2. メイン食材
  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  const ingredientSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  expect((await ingredientSaveResponse).ok()).toBe(true);
  await clickWizardNext(page);

  // 3. ジャンル
  await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
  const cuisineSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );
  await page.getByRole("radio", { name: "和食" }).check();
  expect((await cuisineSaveResponse).ok()).toBe(true);
  await clickWizardNext(page);

  // 4. 作る相手（idea人数N。境界値1・20の両方を1件以上使う）
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
  // useDraftAutosaveは600msデバウンスで保存するため、servings確定操作の直後に
  // save応答を同期点として待ってから次stepへ進む（画面離脱時のunmount flushに
  // 依存せず、確実に永続化された状態でreviewへ到達する）。
  const servingsSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );
  if (servings >= 1 && servings <= 6) {
    await page.getByRole("button", { name: `${String(servings)}人` }).click();
  } else {
    await page.getByLabel("7人以上（20人まで）").selectOption(String(servings));
  }
  expect((await servingsSaveResponse).ok()).toBe(true);
  await clickWizardNext(page);

  // 5. 確認（review）。privacy 未確認でも生成は有効で、説明は secondary ボタンで出す。
  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled();
  await page.getByRole("button", { name: "AI情報の説明を見る" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/privacy");
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();

  // returnTo=/planner?resume=review で review step へ戻る。
  // openPrivacyNotice は flushDraft + setQueryData 済み。本番はフル reload しないため
  // SPA 復帰だけで「5. 確認」を維持することを主張する（巻き戻りは製品退行）。
  await expect(page).toHaveURL(
    (url) => url.pathname === "/planner" && url.searchParams.get("resume") === "review",
  );
  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled();
}

async function completeMinimumPlanner(page: Page) {
  // local OpenRouterの固定success fixtureと同じ家族・食事条件に揃え、
  // E2EがAI応答fixtureの内容ではなく復旧flowだけを検証できるようにする。
  const { resetGlobalAiQuotaForE2e } = await import("../fixtures/reset-global-ai-quota");
  await resetGlobalAiQuotaForE2e();
  await page.goto("/settings");
  // moduleの取得が瞬断で欠けるとSPAがmountせず白紙のままになる。個別の
  // labelを30秒待って初めて気付くのではなく、まず画面が描画できたことを
  // 確認して失敗理由を切り分けられるようにする。
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({
    timeout: 15_000,
  });
  // editorOpen 既定 false のため、呼び名入力前に編集フォームを開く
  await openFirstMemberEditor(page);
  await page.getByRole("textbox", { name: "呼び名" }).fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await openWizardFromHome(page);
  // PlannerWizardは1画面1質問（meal→ingredients→cuisine→audience→review）のため、
  // 旧PlannerForm（同一画面で全条件をradio選択）とは操作手順が異なる。
  await page.getByRole("radio", { name: "朝食" }).check();
  await clickWizardNext(page);
  // getByLabel("メイン食材")はaria-labelledbyを持つsectionとinput要素の両方に
  // マッチしてstrict mode違反になるため、role指定で入力欄だけを絞り込む。
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await clickWizardNext(page);
  await page.getByRole("radio", { name: "和食" }).check();
  await clickWizardNext(page);
  // C-I4: household はメンバー自動選択しない。明示チェック後の成功 autosave を待つ。
  // draftRevisionがserver側で確定する前のPOSTを避けるため、メンバー確定後の
  // 自動保存応答を同期点として待つ（PlannerWizardは「保存済み」の可視表示を持たない）。
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  await selectHouseholdAudienceWithMember(page);
  await clickWizardNext(page);
  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({
    timeout: 10_000,
  });
}

async function expectContainedHorizontally(parent: Locator, child: Locator): Promise<void> {
  const [parentBox, childBox] = await Promise.all([parent.boundingBox(), child.boundingBox()]);
  expect(parentBox).not.toBeNull();
  expect(childBox).not.toBeNull();
  if (parentBox === null || childBox === null) return;

  const tolerance = 1;
  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x - tolerance);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(
    parentBox.x + parentBox.width + tolerance,
  );
}

async function expectSameHorizontalBounds(first: Locator, second: Locator): Promise<void> {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  if (firstBox === null || secondBox === null) return;

  const tolerance = 1;
  expect(Math.abs(firstBox.x - secondBox.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(firstBox.x + firstBox.width - secondBox.x - secondBox.width)).toBeLessThanOrEqual(
    tolerance,
  );
}

async function expectNoHorizontalClipping(element: Locator): Promise<void> {
  const widths = await element.evaluate((target) => ({
    clientWidth: target.clientWidth,
    scrollWidth: target.scrollWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1);
}

async function expectScrollableTablistContent(tablist: Locator): Promise<void> {
  const tablistLayout = await tablist.evaluate((element) => ({
    overflowX: getComputedStyle(element).overflowX,
    scrollWidth: element.scrollWidth,
  }));
  expect(["auto", "scroll"]).toContain(tablistLayout.overflowX);

  const tabs = tablist.getByRole("tab");
  const tabCount = await tabs.count();
  for (let index = 0; index < tabCount; index += 1) {
    const tab = tabs.nth(index);
    await expectNoHorizontalClipping(tab);
    const tabContentBounds = await tab.evaluate((element) => {
      const list = element.closest('[role="tablist"]');
      if (!(list instanceof HTMLElement)) return null;
      const listRect = list.getBoundingClientRect();
      const tabRect = element.getBoundingClientRect();
      const left = tabRect.left - listRect.left + list.scrollLeft;
      return {
        left,
        right: left + tabRect.width,
        scrollWidth: list.scrollWidth,
      };
    });
    expect(tabContentBounds).not.toBeNull();
    if (tabContentBounds === null) continue;
    expect(tabContentBounds.left).toBeGreaterThanOrEqual(-1);
    expect(tabContentBounds.right).toBeLessThanOrEqual(tabContentBounds.scrollWidth + 1);
  }
}

test("resends the same key after the first POST is aborted before server acceptance (connectionreset, no handler completion)", async ({
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

test("recovers a persisted result when handler completes but response is dropped (X-Kondate-E2E-Drop-Response after-handler)", async ({
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

test("shows result details and keeps major regions within their parent", async ({
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
      "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
    ),
  ).toBeVisible();
  for (const width of [320, 390, 916]) {
    await page.setViewportSize({ width, height: 844 });

    // ページ全体のoverflowを隠すだけでは検出できないため、主要領域自身と
    // レイアウト祖先の左右境界を実測する。タブ列内部の横スクロールは除外する。
    const html = page.locator("html");
    const body = page.locator("body");
    const appSection = page.locator(".app-section");
    const root = page.locator("#root");
    const pageContainer = page.locator("main");
    const pageDisclaimer = page.getByText(
      "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
    );
    const resultRoot = page.getByRole("heading", { name: "献立ができました" }).locator("..");
    const timeline = page.getByRole("heading", { name: "全体の段取り" }).locator("..");
    const tablist = page.getByRole("tablist", { name: "料理" });
    const tabpanel = page.getByRole("tabpanel");
    await expectContainedHorizontally(html, body);
    await expectContainedHorizontally(body, root);
    await expectContainedHorizontally(root, appSection);
    await expectContainedHorizontally(appSection, pageContainer);
    await expectContainedHorizontally(pageContainer, resultRoot);
    await expectSameHorizontalBounds(pageDisclaimer, resultRoot);
    await expectContainedHorizontally(resultRoot, timeline);
    await expectContainedHorizontally(resultRoot, tablist);
    await expectContainedHorizontally(resultRoot, tabpanel);
    for (const clippingBoundary of [
      html,
      body,
      root,
      appSection,
      pageContainer,
      pageDisclaimer,
      resultRoot,
      timeline,
      tabpanel,
    ]) {
      await expectNoHorizontalClipping(clippingBoundary);
    }
    await expectScrollableTablistContent(tablist);

    const overflowingContent = await resultRoot.evaluate((resultElement) => {
      const rootRect = resultElement.getBoundingClientRect();
      return [...resultElement.querySelectorAll("*")]
        .filter((element) => !element.closest('[role="tablist"]'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1;
        })
        .map((element) => element.tagName);
    });
    expect(overflowingContent).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }

  // 既存修正がbaseに含まれるため、hiddenで切れた非tab領域を一時注入し、
  // 本テストのscrollWidth検査がクリップを実際に検出できることを確認する。
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "horizontal-clipping-negative-control";
    probe.style.width = "100px";
    probe.style.overflowX = "hidden";
    const oversizedContent = document.createElement("div");
    oversizedContent.style.width = "200px";
    oversizedContent.style.height = "10px";
    oversizedContent.style.whiteSpace = "nowrap";
    oversizedContent.textContent = "W".repeat(200);
    probe.append(oversizedContent);
    document.body.append(probe);
  });
  const negativeControl = page.locator("#horizontal-clipping-negative-control");
  await expect(expectNoHorizontalClipping(negativeControl)).rejects.toThrow();
  await negativeControl.evaluate((element) => {
    element.remove();
  });
});

// --- idea結果境界E2E（Task 6/7） ---
// 家族設定を省略したidea利用者が4質問→人数N→privacy→reviewを経て生成し、
// 結果画面にnoticeと許可操作が表示され、買い物・家族安全通信が一切発生しないこと
// を固定する。Nの境界値は1と20の両方を検証する。

async function assertIdeaResultBoundary(page: Page, servings: number): Promise<void> {
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  // notice: idea 必須2文は常時表示。AI/ラベル長文はダイアログで確認。
  await expectIdeaResultSurface(page);
  await openAndAssertIdeaSafetyDetails(page);
  // 結果画面に別の「閉じる」がある場合があるため、安全詳細 dialog に限定する。
  const ideaSafetyDialog = page.getByRole("dialog", {
    name: "この献立はアイデアとして作成しました",
  });
  await ideaSafetyDialog.getByRole("button", { name: "閉じる" }).click();
  // 人数表示。menu.servings === N であることを本文の「N人分」表示で確認する。
  await expect(page.getByText(`${String(servings)}人分`, { exact: false })).toBeVisible();
  // 許可操作: 採用・お気に入り・whole/dish 再生成は利用できる
  // dialog 閉鎖直後は action bar の再描画待ちが必要なことがある
  await expect(page.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "この一品だけ別案にする" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "この献立にする" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "お気に入りに追加" })).toBeVisible({
    timeout: 15_000,
  });
  // idea-servings モックは pantry 未使用。未使用時は在庫更新 CTA を出さない（1d78167）。
  await expect(page.getByRole("button", { name: "使った食材の在庫を更新" })).toHaveCount(0);
  // 買い物だけは idea では非表示のまま
  await expect(page.getByRole("button", { name: "材料の買い物リストを作る" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "買い物リストの差分を見る" })).toHaveCount(0);
}

function isAppGenerationMenuUrl(url: URL, appOrigin: string): boolean {
  return url.origin === appOrigin && url.pathname === "/api/generations/menu";
}

for (const servings of [1, 20] as const) {
  test(`generates an idea menu for servings=${String(servings)} boundary without mounting household actions or shopping requests`, async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(90_000);
    const forbiddenIdeaResultRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      // create/preview/reconcile/revalidate の shopping 4 endpoint と
      // 家族 revalidation は idea 結果で mount されないため 0 件。
      // 初回生成の /api/generations/menu はこの test の主操作として許可する。
      // dish 再生成は本 test では起動しない（別 E2E で検証）。
      if (
        path.startsWith("/api/shopping-lists/") ||
        /^\/api\/menus\/[^/]+\/revalidate$/u.test(path)
      ) {
        forbiddenIdeaResultRequests.push(path);
      }
    });

    await completeIdeaPlannerToReview(page, servings);
    const appOrigin = new URL(page.url()).origin;
    // sticky: recovery 再送でも idea-servings fixture が外れない（E2E7）
    await setMockScenario(page, `idea-servings-${String(servings)}`);
    const generationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isAppGenerationMenuUrl(new URL(response.url()), appOrigin),
    );
    await page.getByRole("button", { name: "献立を作る" }).click();
    const generationResponse = await generationResponsePromise;
    const generationResponseBody = await generationResponse.text();
    let generationResult: unknown;
    try {
      generationResult = JSON.parse(generationResponseBody);
    } catch {
      generationResult = null;
    }
    const succeededResponse = z
      .object({
        ok: z.literal(true),
        data: z.looseObject({ status: z.literal("succeeded") }),
      })
      .safeParse(generationResult);
    if (!generationResponse.ok() || !succeededResponse.success) {
      throw new Error(
        `献立生成POSTが成功終端になりませんでした（HTTP ${String(generationResponse.status())}）: ${generationResponseBody}`,
      );
    }
    await assertIdeaResultBoundary(page, servings);

    // shoppingのcreate/preview/reconcile/revalidate requestが0件であることを確認する。
    expect(forbiddenIdeaResultRequests).toHaveLength(0);

    // sessionStorageにkondate:shopping: prefixのkeyが0件であることを確認する。
    const shoppingSessionKeys = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) => key.startsWith("kondate:shopping:")),
    );
    expect(shoppingSessionKeys).toHaveLength(0);

    // 保存されたmenu rowのservingsが同じNであることをDB上でも直接確認する。
    const menuIdMatch = /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname);
    if (menuIdMatch?.[1] === undefined)
      throw new Error("生成された献立IDをURLから取得できませんでした");
    const headers = await localRestHeaders(page);
    const menuLookup = await page.request.get(
      `http://127.0.0.1:8000/rest/v1/menus?id=eq.${menuIdMatch[1]}&select=servings,target_mode`,
      { headers },
    );
    const menuRows = z
      .array(z.object({ servings: z.number(), target_mode: z.string() }))
      .parse(await menuLookup.json());
    expect(menuRows[0]?.servings).toBe(servings);
    expect(menuRows[0]?.target_mode).toBe("idea");

    // Task 8: idea source への新規 shopping mutation key は 422 idea_menu_not_supported
    // （UI は mount しないが HTTP 境界を E2E でも固定する）
    const ideaShopping = await page.request.post(
      "http://127.0.0.1:5173/api/shopping-lists/from-menu",
      {
        headers: {
          ...headers,
          origin: "http://127.0.0.1:5173",
        },
        data: {
          menuId: menuIdMatch[1],
          mode: "new",
          activeListId: null,
          expectedListVersion: null,
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    expect(ideaShopping.status()).toBe(422);
    const ideaShoppingBody = z
      .object({ ok: z.literal(false), error: z.object({ code: z.string() }) })
      .parse(await ideaShopping.json());
    expect(ideaShoppingBody.error.code).toBe("idea_menu_not_supported");
  });
}

test("ingredient empty next uses toast and alert instead of alertdialog", async ({
  authenticatedPage: page,
}) => {
  // 設計 §6.3: メイン食材 0 件の「次へ」は empty alertdialog ではなく
  // toast(status) + inline alert + 入力 focus。遷移しない。
  await expect(page).toHaveURL((url) => url.pathname === "/welcome");
  await page.getByRole("button", { name: "献立アイデアを考える" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/planner");
  await page.getByRole("button", { name: "今日の献立をつくる" }).click();
  await page.getByRole("radio", { name: "朝食" }).check();
  await clickWizardNext(page);
  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  await expect(page.getByRole("button", { name: "次へ" })).toBeEnabled();
  await clickWizardNext(page);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("メイン食材を1つ以上選んでください");
  // autosave/billing の status と同居するため、検証トーストは文言で絞る
  await expect(
    page.getByRole("status").filter({ hasText: "メイン食材を1つ以上選んでください" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "メイン食材" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
});

test("offers only in-range servings so an out-of-range draft cannot be composed", async ({
  authenticatedPage: page,
}) => {
  // shared/contracts/planner.tsのservingsスキーマ（1〜20）とDB CHECK制約
  // （generation_drafts_target_mode_servings_check）は1〜20の範囲を要求する。
  // 7人以上の入力は number input からプルダウンへ変えたため、範囲外の値は
  // UI上に存在しない=range違反のdraftが構成不能になった（DB RPC経由の直接注入も
  // CHECK制約でreject）。fail-closed を「選択肢の集合」として検証する。
  await expect(page).toHaveURL((url) => url.pathname === "/welcome");
  await page.getByRole("button", { name: "献立アイデアを考える" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/planner");
  await page.getByRole("button", { name: "今日の献立をつくる" }).click();
  await page.getByRole("radio", { name: "朝食" }).check();
  await clickWizardNext(page);
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await clickWizardNext(page);
  await page.getByRole("radio", { name: "和食" }).check();
  await clickWizardNext(page);
  // 設計 L9: 人数だけ → 家族に合わせて（0 メンバー時は後者 disabled）
  const audienceRadios = page.getByRole("radio");
  await expect(audienceRadios).toHaveCount(2);
  await expect(audienceRadios.nth(0)).toHaveAccessibleName(/人数だけ指定してアイデアを見る/u);
  await expect(audienceRadios.nth(1)).toHaveAccessibleName(/家族に合わせて作る/u);
  await expect(audienceRadios.nth(1)).toBeDisabled();

  await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
  const servingsSelect = page.getByLabel("7人以上（20人まで）");
  // 未選択のうちは1〜6のチップも押されておらず、incomplete のまま。
  // 旧: 次へ disabled。現: 押下可 + toast(status) + inline alert（設計 §6.3）。
  for (const count of [1, 2, 3, 4, 5, 6]) {
    await expect(page.getByRole("button", { name: `${String(count)}人` })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  }
  const next = page.getByRole("button", { name: "次へ" });
  await expect(next).toBeEnabled();
  await clickWizardNext(page);
  await expect(page.getByRole("alert")).toContainText("人数を選んでください");
  // autosave/billing の status と同居するため、検証トーストは文言で絞る
  await expect(page.getByRole("status").filter({ hasText: "人数を選んでください" })).toBeVisible();
  // 遷移しない
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  // 21のような範囲外は選択肢として存在しない。
  await expect(servingsSelect.locator("option")).toHaveText([
    "選ばない",
    "7人",
    "8人",
    "9人",
    "10人",
    "11人",
    "12人",
    "13人",
    "14人",
    "15人",
    "16人",
    "17人",
    "18人",
    "19人",
    "20人",
  ]);
  await servingsSelect.selectOption("20");
  await expect(next).toBeEnabled();
});

// --- 5-route smoke matrix（Task 6 Step 13 / Task 9 idea 許可） ---
// skippedかつ家族0人の利用者が/pantry, /history, /shopping, /settings,
// /emergency-menusを直接開いた場合、onboarding redirectなし・page errorなし・
// 理解可能なempty state・禁止 side-effect が0件であることを固定する。
// idea 下書き時の GET /api/emergency-menus?targetMode=idea は許可する。

test.describe("5-route smoke matrix for a skipped user with zero household members", () => {
  test("visits pantry, history, shopping, settings, and emergency-menus without onboarding redirect or family-safety activity", async ({
    authenticatedPage: page,
  }) => {
    // ideaを選ぶとonboarding_statusがskippedへ進む（audienceでideaを確定した時点）。
    // ここでは家族設定を経由せず、welcomeから直接ideaを選んでskippedへ進める。
    await expect(page).toHaveURL((url) => url.pathname === "/welcome");
    await page.getByRole("button", { name: "献立アイデアを考える" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/planner");

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });
    const routeNames = ["pantry", "history", "shopping", "settings", "emergency-menus"] as const;
    type RouteName = (typeof routeNames)[number];
    // 禁止 side-effect のみ route 別に記録（idea emergency API は許可のため含めない）
    const disallowedSafetySideEffectRequests: Record<RouteName, string[]> = {
      pantry: [],
      history: [],
      shopping: [],
      settings: [],
      "emergency-menus": [],
    };
    let activeRoute: RouteName | null = null;
    page.on("request", (request) => {
      if (activeRoute === null) return;
      const url = new URL(request.url());
      const path = url.pathname;

      // 許可: GET /api/emergency-menus?targetMode=idea
      // 禁止（idea 訪問中 activeRoute==="emergency-menus" でも 0 件）:
      //   - household emergency API（targetMode≠idea）
      //   - shopping / generation / revalidate
      //   - get_current_safety_snapshot RPC
      //   - PostgREST household_members / member_allergies（settings 以外）
      const isEmergencyMenus = path === "/api/emergency-menus";
      const isIdeaEmergency = isEmergencyMenus && url.searchParams.get("targetMode") === "idea";

      const isSafetyRpc =
        path.endsWith("/rest/v1/rpc/get_current_safety_snapshot") ||
        path.includes("/rpc/get_current_safety_snapshot");
      const isHouseholdMembersRead =
        path.includes("/rest/v1/household_members") || path.endsWith("/household_members");
      const isMemberAllergiesRead =
        path.includes("/rest/v1/member_allergies") || path.endsWith("/member_allergies");

      const isDisallowedSideEffect =
        (isEmergencyMenus && !isIdeaEmergency) ||
        path.startsWith("/api/shopping-lists/") ||
        path === "/api/generations/dish" ||
        /^\/api\/menus\/[^/]+\/revalidate$/u.test(path) ||
        isSafetyRpc ||
        // emergency-menus 訪問中の家族表読込は禁止（settings は activeRoute が settings のときだけ許容）
        (activeRoute === "emergency-menus" && (isHouseholdMembersRead || isMemberAllergiesRead));

      if (isDisallowedSideEffect) {
        disallowedSafetySideEffectRequests[activeRoute].push(path + url.search);
      }
    });

    activeRoute = "pantry";
    await page.goto("/pantry");
    await expect(page).toHaveURL((url) => url.pathname === "/pantry");
    await expect(page.getByRole("heading", { name: "食材リスト" })).toBeVisible();

    activeRoute = "history";
    await page.goto("/history");
    await expect(page).toHaveURL((url) => url.pathname === "/history");
    await expect(page.getByRole("heading", { name: "作った献立" })).toBeVisible();
    await expect(page.getByText("まだ献立がありません")).toBeVisible();

    activeRoute = "shopping";
    await page.goto("/shopping");
    await expect(page).toHaveURL((url) => url.pathname === "/shopping");
    await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible();
    await expect(page.getByText("買い物リストは空です")).toBeVisible();

    activeRoute = "settings";
    await page.goto("/settings");
    await expect(page).toHaveURL((url) => url.pathname === "/settings");
    await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible();
    // 0 人 empty: 見出し「家族を追加する」と CTA「家族を追加」（旧文言「家族を追加してください」は廃止）
    await expect(page.getByRole("heading", { name: "家族を追加する" })).toBeVisible();
    await expect(page.getByRole("button", { name: "家族を追加" })).toBeVisible();

    // /emergency-menusは下書きなしとidea下書きの両方を検証する。
    // まず下書きなし（このユーザーはまだplanner下書きを保存していない）。
    // draft-none では emergency API も呼ばず empty のまま。
    activeRoute = "emergency-menus";
    await page.goto("/emergency-menus");
    await expect(page).toHaveURL((url) => url.pathname === "/emergency-menus");
    await expect(page.getByRole("heading", { name: "15分緊急献立" })).toBeVisible();
    await expect(
      page.getByText("献立条件の下書きがありません。献立画面で条件を保存してください。"),
    ).toBeVisible();
    // idea下書き（家族条件を持たない）を作ってから再訪する。/planner自身の
    // household_members取得は家族安全actionではないため、route listenerを
    // 外さずに記録対象外として扱う（activeRoute = null）。
    activeRoute = null;
    await openWizardFromHome(page);
    await page.getByRole("radio", { name: "夕食" }).check();
    await clickWizardNext(page);
    await page.getByRole("textbox", { name: "メイン食材" }).fill("豆腐");
    await page.getByRole("button", { name: "追加" }).click();
    await clickWizardNext(page);
    await page.getByRole("radio", { name: "中華" }).check();
    await clickWizardNext(page);
    await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
    // PlannerWizardは「保存済み」の可視表示を持たないため、servings確定の
    // 自動保存応答自体を同期点として待つ。
    const servingsSaveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
    );
    await page.getByRole("button", { name: "2人" }).click();
    expect((await servingsSaveResponse).ok()).toBe(true);
    // idea 経路の emergency API を明示捕捉（targetMode=idea 固定）
    const ideaEmergencyUrls: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/emergency-menus") {
        ideaEmergencyUrls.push(request.url());
      }
    });
    activeRoute = "emergency-menus";
    await page.goto("/emergency-menus");
    await expect(page).toHaveURL((url) => url.pathname === "/emergency-menus");
    await expect(page.getByRole("heading", { name: "15分緊急献立" })).toBeVisible();
    // idea 許可: 旧ブロック文言は出さず、idea 開示 intro または候補 chrome を示す
    await expect(
      page.getByText(
        "アイデアモードでは緊急献立を表示できません。献立画面で「家族向け」に切り替えてください。",
      ),
    ).toHaveCount(0);
    // intro は draftReady 後 role=status で出る。候補が載れば「候補 1」も見える。
    await expect(
      page.getByText(
        "個人向けの固定候補です。家族のアレルギー・年齢条件は適用していません。AI利用回数は消費しません。調理前に原材料表示と家庭内の混入を確認してください。",
      ),
    ).toBeVisible();
    // 豆腐 main で idea 夕食 fixture が載る設計 coverage。候補 chrome も非空であること。
    await expect(page.getByText("候補 1", { exact: true })).toBeVisible();
    await expect.poll(() => ideaEmergencyUrls.length).toBeGreaterThan(0);
    const firstIdeaEmergency = ideaEmergencyUrls.at(0);
    if (firstIdeaEmergency === undefined) {
      throw new Error("idea emergency request was not captured");
    }
    const ideaRequestUrl = new URL(firstIdeaEmergency);
    expect(ideaRequestUrl.searchParams.get("targetMode")).toBe("idea");
    // 豆腐 main が Stage M に乗れば banner なし。miss 時のみ idea safety_only exact。
    // いずれにせよ household の「安全条件に合う」文言は idea 表示中に出さない。
    await expect(
      page.getByText("メイン食材は一致しませんでした。安全条件に合う候補を表示しています。"),
    ).toHaveCount(0);

    expect(pageErrors).toHaveLength(0);
    for (const routeName of routeNames) {
      expect(disallowedSafetySideEffectRequests[routeName]).toEqual([]);
    }
  });
});

// --- Plan 7 Task 8: 320px / keyboard / reduced-motion / 200% ---
// PlannerWizard は共有 WizardFrame ではなく step ごとの section を描画する。
// 44px は primary/戻る等の操作 button に適用し、native radio の見た目サイズは対象外。
//
// レイアウト契約（320px / 44px）は programmatic focus + keyboard 起動で測定する。
// Tab 順の証明は「keyboard only」test に限定し、未到達時の .focus() フォールバックは使わない。

/** 主要操作の bounding box が 44 CSS px 以上であることを 1 コントロール単位で固定する */
async function expectMajorActionAtLeast44(
  page: import("@playwright/test").Page,
  name: string | RegExp,
): Promise<void> {
  const control = page.getByRole("button", { name });
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box, `missing bounding box for ${String(name)}`).not.toBeNull();
  if (box === null) throw new Error(`missing bounding box for ${String(name)}`);
  expect(box.height, `${String(name)} height`).toBeGreaterThanOrEqual(44);
}

/** 320 CSS px で横スクロールが出ていないこと */
async function expectNoHorizontalScroll(page: import("@playwright/test").Page): Promise<void> {
  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
  );
  expect(noHorizontalScroll).toBe(true);
}

/**
 * フォーカス中の操作を Space/Enter で起動する。
 * レイアウト契約用。Tab 順証明には使わない programmatic focus 経路の補助。
 */
async function activateFocusedWithKeyboard(
  page: import("@playwright/test").Page,
  key: "Space" | "Enter" = "Enter",
): Promise<void> {
  await page.keyboard.press(key);
}

/** 現在フォーカス要素の role / name 等を読む（Tab 順プローブ用） */
async function readFocusedControl(page: import("@playwright/test").Page): Promise<{
  role: string | null;
  type: string | null;
  name: string;
  tagName: string;
  disabled: boolean;
}> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body || el === document.documentElement) {
      return { role: null, type: null, name: "", tagName: "", disabled: true };
    }
    const role = el.getAttribute("role");
    const type = el.getAttribute("type");
    // accessible name の近似: aria-label → <label> 関連付け → 自身の textContent。
    // native radio は input 自身の textContent が空で、label 内テキストが名前になる。
    const ariaLabel = el.getAttribute("aria-label");
    let name = "";
    if (ariaLabel !== null && ariaLabel !== "") {
      name = normalize(ariaLabel);
    } else if (
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement) &&
      el.labels !== null &&
      el.labels.length > 0
    ) {
      name = normalize(
        Array.from(el.labels)
          .map((label) => label.textContent)
          .join(" "),
      );
    } else {
      name = normalize(el.textContent);
    }
    const disabledAttr = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
    const formDisabled =
      el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
        ? el.disabled
        : false;
    return {
      role,
      type,
      name,
      tagName: el.tagName.toLowerCase(),
      disabled: disabledAttr || formDisabled,
    };
  });
}

/**
 * Tab を押し続けて predicate に合うコントロールへ到達する。
 * 未到達は fail hard（programmatic .focus() フォールバック禁止）。
 */
async function tabUntil(
  page: import("@playwright/test").Page,
  match: (focus: Awaited<ReturnType<typeof readFocusedControl>>) => boolean,
  label: string,
  maxTabs = 32,
): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press("Tab");
    const focus = await readFocusedControl(page);
    if (match(focus)) {
      return;
    }
  }
  throw new Error(`Tab did not reach ${label} within ${String(maxTabs)} presses`);
}

test.describe("wizard accessibility and layout contracts", () => {
  test("fits 320px without horizontal scroll and keeps multi-step 44px action targets", async ({
    authenticatedPage: page,
  }) => {
    // 契約の正本は 320 CSS px。Playwright の viewport は CSS px 単位のため 320 で固定する。
    // 200% 拡大はブラウザ zoom であり deviceScaleFactor とは別経路のため、
    // ここでは scrollWidth 契約と 44px 操作領域を 320 で固定検証する。
    // 本 test はレイアウト測定専用で、Tab 順の証明はしない（下記 keyboard-only test が担う）。
    await page.setViewportSize({ width: 320, height: 720 });
    await expect(page).toHaveURL((url) => url.pathname === "/welcome");
    await page.getByRole("button", { name: "献立アイデアを考える" }).focus();
    await activateFocusedWithKeyboard(page);
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    // Phase 4: ホーム主 CTA からウィザードへ（レイアウト契約の本体は各 step 側）
    await page.getByRole("button", { name: "今日の献立をつくる" }).focus();
    await activateFocusedWithKeyboard(page);
    await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();

    // --- 1. 食事 ---
    await expectNoHorizontalScroll(page);
    await page.getByRole("radio", { name: "朝食" }).focus();
    await activateFocusedWithKeyboard(page, "Space");
    await expect(page.getByRole("button", { name: "次へ" })).toBeEnabled();
    await expectMajorActionAtLeast44(page, "次へ");
    await page.getByRole("button", { name: "次へ" }).focus();
    await activateFocusedWithKeyboard(page);

    // --- 2. メイン食材 ---
    await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
    await expectMajorActionAtLeast44(page, "追加");
    await page.getByRole("button", { name: "追加" }).focus();
    await activateFocusedWithKeyboard(page);
    await expectMajorActionAtLeast44(page, "次へ");
    await expectMajorActionAtLeast44(page, "戻る");
    await page.getByRole("button", { name: "次へ" }).focus();
    await activateFocusedWithKeyboard(page);

    // --- 3. ジャンル ---
    await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("radio", { name: "和食" }).focus();
    await activateFocusedWithKeyboard(page, "Space");
    await expectMajorActionAtLeast44(page, "次へ");
    await expectMajorActionAtLeast44(page, "戻る");
    await page.getByRole("button", { name: "次へ" }).focus();
    await activateFocusedWithKeyboard(page);

    // --- 4. 作る相手（idea 人数） ---
    await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).focus();
    await activateFocusedWithKeyboard(page, "Space");
    await page.getByRole("button", { name: "2人" }).focus();
    await activateFocusedWithKeyboard(page);
    await expect(page.getByRole("button", { name: "2人" })).toHaveAttribute("aria-pressed", "true");
    await expectMajorActionAtLeast44(page, "2人");
    await expectMajorActionAtLeast44(page, "次へ");
    await page.getByRole("button", { name: "次へ" }).focus();
    await activateFocusedWithKeyboard(page);

    // --- 5. 確認 ---
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectMajorActionAtLeast44(page, "戻る");
    await expectMajorActionAtLeast44(page, "献立を作る");
    // AI 説明ボタンが存在する step では 44px を要求する
    const privacy = page.getByRole("button", { name: /AI情報の説明/u });
    if ((await privacy.count()) > 0) {
      await expectMajorActionAtLeast44(page, /AI情報の説明/u);
    }
  });

  test("advances four questions to review and privacy using keyboard only", async ({
    authenticatedPage: page,
  }) => {
    // Tab / Space / Enter のみ。未到達時の programmatic .focus() フォールバックは禁止。
    await page.setViewportSize({ width: 320, height: 720 });
    await expect(page).toHaveURL((url) => url.pathname === "/welcome");

    await tabUntil(
      page,
      (focus) => focus.name.includes("献立アイデアを考える") && !focus.disabled,
      'welcome CTA "献立アイデアを考える"',
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    // Phase 4: ホーム経由。主 CTA をキーボードで開いてからウィザード契約を検証する。
    await tabUntil(
      page,
      (focus) => focus.name.includes("今日の献立をつくる") && !focus.disabled,
      'home CTA "今日の献立をつくる"',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
    // step 表示直後に heading へ focus（MealStep 等の契約）
    await expect(page.getByRole("heading", { name: "1. 食事" })).toBeFocused();

    // --- 1. 食事: Tab → 朝食 radio → Space → Tab → 次へ → Enter ---
    await tabUntil(
      page,
      (focus) => (focus.role === "radio" || focus.type === "radio") && focus.name.includes("朝食"),
      'meal radio "朝食"',
    );
    await page.keyboard.press("Space");
    await expect(page.getByRole("radio", { name: "朝食" })).toBeChecked();
    await tabUntil(
      page,
      (focus) => focus.name === "次へ" && !focus.disabled,
      'meal primary "次へ"',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeFocused();

    // --- 2. メイン食材: Tab → textbox → type → Tab → 追加 → Enter → Tab → 次へ → Enter ---
    await tabUntil(
      page,
      (focus) =>
        (focus.tagName === "input" || focus.tagName === "textarea" || focus.role === "textbox") &&
        focus.name.includes("メイン食材"),
      'ingredient textbox "メイン食材"',
      40,
    );
    await expect(page.getByRole("textbox", { name: "メイン食材" })).toBeFocused();
    await page.keyboard.type("鶏肉");
    await tabUntil(page, (focus) => focus.name === "追加" && !focus.disabled, 'ingredient "追加"');
    await page.keyboard.press("Enter");
    await tabUntil(
      page,
      (focus) => focus.name === "次へ" && !focus.disabled,
      'ingredient primary "次へ"',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeFocused();

    // --- 3. ジャンル ---
    await tabUntil(
      page,
      (focus) => (focus.role === "radio" || focus.type === "radio") && focus.name.includes("和食"),
      'cuisine radio "和食"',
    );
    await page.keyboard.press("Space");
    await tabUntil(
      page,
      (focus) => focus.name === "次へ" && !focus.disabled,
      'cuisine primary "次へ"',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeFocused();

    // --- 4. 作る相手（idea + 2人） ---
    await tabUntil(
      page,
      (focus) =>
        (focus.role === "radio" || focus.type === "radio") &&
        focus.name.includes("人数だけ指定してアイデアを見る"),
      "audience idea radio",
      40,
    );
    await page.keyboard.press("Space");
    await tabUntil(
      page,
      (focus) => focus.name === "2人" && !focus.disabled,
      'audience servings "2人"',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "2人" })).toHaveAttribute("aria-pressed", "true");
    await tabUntil(
      page,
      (focus) => focus.name === "次へ" && !focus.disabled,
      'audience primary "次へ"',
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeFocused();

    // --- 5. 確認: Tab で AI 説明または生成操作へ到達 ---
    await tabUntil(
      page,
      (focus) =>
        focus.name.includes("AI情報の説明を見る") ||
        focus.name.includes("AI情報の説明") ||
        focus.name.includes("献立を作る"),
      "review privacy or generate action",
      40,
    );
  });

  test("disables wizard-transition animation under prefers-reduced-motion", async ({
    authenticatedPage: page,
  }) => {
    // Planner 本体は step section を使うが、Task 1 の CSS 契約（.wizard-transition）は
    // prefers-reduced-motion: reduce で animation:none になることを DOM 注入で固定する。
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page).toHaveURL((url) => url.pathname === "/welcome");
    await page.getByRole("button", { name: "献立アイデアを考える" }).click();
    await page.getByRole("button", { name: "今日の献立をつくる" }).click();
    await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
    const animationName = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "wizard-transition";
      document.body.append(probe);
      const name = getComputedStyle(probe).animationName;
      probe.remove();
      return name;
    });
    expect(animationName === "none" || animationName === "").toBe(true);
  });
});
