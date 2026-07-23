import type { Page } from "@playwright/test";
import { z } from "zod";
import { expect, test as authTest } from "./auth";
import { accessTokenFromPage, localRestHeaders } from "./local-supabase";

type HistoryFixtures = { historyPage: Page };

/**
 * 履歴・再生成ジャーニー用。認証 + 最低限オンボーディング完了後に /planner へ置く。
 */
export const test = authTest.extend<HistoryFixtures>({
  historyPage: async ({ completedOnboardingPage: page }, provide) => {
    await provide(page);
  },
});
export { expect };

/**
 * wizard の「次へ」を bottom-nav に遮られず押す。
 * Playwright の pointer click は fixed bottom-nav が重なると nav 側へ吸われるため、
 * 対象 button 自身の DOM click() で React の onClick を発火させる。
 */
export async function clickWizardNext(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "次へ" });
  await expect(next).toBeVisible();
  await next.evaluate((el: HTMLElement) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    // disabled なら何もしない（完了条件未達のまま進まない）
    if (el instanceof HTMLButtonElement && el.disabled) {
      throw new Error("wizard next button is disabled");
    }
    el.click();
  });
}

/** 次の generation POST だけに mock シナリオヘッダを付ける（Compose mock 時のみサーバが尊重） */
export async function setMockScenario(page: Page, scenario: string): Promise<void> {
  await page.route(
    (url) => {
      const path = new URL(url).pathname;
      return path === "/api/generations/menu" || path === "/api/generations/dish";
    },
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.continue({
        headers: {
          ...route.request().headers(),
          "x-kondate-mock-scenario": scenario,
        },
      });
    },
    { times: 1 },
  );
}

/**
 * 固定 success fixture と整合する条件で献立を1件生成し、menuId を返す。
 */
export async function seedGeneratedMenu(page: Page): Promise<string> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("呼び名").fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
  await page.getByRole("radio", { name: "朝食" }).check();
  await clickWizardNext(page);
  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await clickWizardNext(page);
  await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
  await page.getByRole("radio", { name: "和食" }).check();
  await clickWizardNext(page);
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  const audienceSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );
  await page.getByRole("radio", { name: "家族に合わせて作る" }).check();
  expect((await audienceSaveResponse).ok()).toBe(true);
  await clickWizardNext(page);
  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 60_000 });
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 15_000,
  });
  const menuId = /\/menus\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/iu.exec(
    new URL(page.url()).pathname,
  )?.[1];
  return z.uuid().parse(menuId);
}

/** GET /api/usage/today の成功残数 */
export async function readRemainingQuota(page: Page): Promise<number> {
  const response = await page.request.get("/api/usage/today", {
    headers: {
      authorization: `Bearer ${await accessTokenFromPage(page)}`,
    },
  });
  const body = z
    .object({
      ok: z.literal(true),
      data: z.looseObject({
        success: z.object({ remaining: z.number().int().nonnegative() }),
      }),
    })
    .parse(await response.json());
  return body.data.success.remaining;
}

/**
 * 結果画面（/menus または /history）から献立全体の再生成を開始する。
 * クリック後、生成完了または失敗画面への遷移を待つ。
 * household は家族再検証の完了を待ち、idea は notice 表示を待つ。
 */
export async function requestWholeRegeneration(
  page: Page,
  menuId: string,
  reason: "simpler" | "different_ingredient" | "child_friendly" | "different_flavor",
  options: { targetMode?: "household" | "idea" } = {},
): Promise<void> {
  const targetMode = options.targetMode ?? "household";
  // 結果画面の再生成コントロールを使う（履歴詳細と同等の UI）
  await page.goto(`/menus/${menuId}`);
  if (targetMode === "household") {
    await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({
      timeout: 30_000,
    });
  } else {
    await expect(page.getByText("家族条件を使用していません")).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
  // idea では child_friendly 自体が DOM に無い
  if (targetMode === "idea") {
    await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  }
  const reasonLabel = {
    simpler: "もっと簡単に",
    different_ingredient: "別の食材で",
    child_friendly: "子どもが食べやすく",
    different_flavor: "別の味に",
  }[reason];
  await page.getByRole("radio", { name: reasonLabel }).check();
  // すでに /menus/:source にいるため waitForURL(/menus/) は即成立してしまう。
  // source 以外の path（/generation または別 menuId）へ移るまで待つ。
  await page.getByRole("button", { name: "別案を作る" }).click();
  await page.waitForFunction(
    (sourceId) => {
      const path = window.location.pathname;
      if (path === "/generation" || path.startsWith("/generation?")) return true;
      const match = /\/menus\/([0-9a-f-]{36})/iu.exec(path);
      return match !== null && match[1] !== sourceId;
    },
    menuId,
    { timeout: 90_000 },
  );
}

/**
 * idea モードで1件生成し menuId を返す。
 * completed/skipped 利用者でも /planner から idea 対象を選んで生成できる。
 * mock scenario は呼び出し側で setMockScenario する。
 */
export async function seedGeneratedIdeaMenu(page: Page, servings: 1 | 2 | 20 = 2): Promise<string> {
  const waitDraftSave = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
    );

  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible({
    timeout: 15_000,
  });
  const mealSave = waitDraftSave();
  await page.getByRole("radio", { name: "朝食" }).check();
  expect((await mealSave).ok()).toBe(true);
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  const ingredientSave = waitDraftSave();
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  expect((await ingredientSave).ok()).toBe(true);
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
  const cuisineSave = waitDraftSave();
  await page.getByRole("radio", { name: "和食" }).check();
  expect((await cuisineSave).ok()).toBe(true);
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  // draft CHECK は idea かつ servings 1〜20 を要求する。mode だけ先に保存すると
  // idea+servings=null で 400 になるため、人数を debounce(600ms) 内に続けて確定し、
  // 有効な idea 行を1回の autosave で永続化する。
  const ideaSave = waitDraftSave();
  await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
  if (servings >= 1 && servings <= 6) {
    await page.getByRole("button", { name: `${String(servings)}人` }).click();
  } else {
    await page.getByLabel("7人以上（20人まで）").fill(String(servings));
  }
  expect((await ideaSave).ok()).toBe(true);
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  // privacy 未確認なら説明へ。returnTo=/planner?resume=review で戻ったあと、
  // react-query の stale draft cache で step 1 へ巻き戻る既知差異を reload で回避する
  // （generation-recovery-results の completeIdeaPlannerToReview と同手順）。
  const generateButton = page.getByRole("button", { name: "献立を作る" });
  if (await generateButton.isDisabled()) {
    await page.getByRole("button", { name: "AI情報の説明を見る" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await page.reload();
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 60_000 });
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({
    timeout: 30_000,
  });
  const menuId = /\/menus\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/iu.exec(
    new URL(page.url()).pathname,
  )?.[1];
  return z.uuid().parse(menuId);
}

/** 最初の complete メンバーの allergy_status を unconfirmed にして再検証を無効化する */
export async function changeFirstMemberSafety(page: Page): Promise<void> {
  const headers = await localRestHeaders(page);
  const rows = z
    .array(z.object({ id: z.uuid() }))
    .parse(
      await (
        await page.request.get(
          "http://127.0.0.1:8000/rest/v1/household_members?status=eq.complete&select=id&limit=1",
          { headers },
        )
      ).json(),
    );
  const id = z.uuid().parse(rows[0]?.id);
  const response = await page.request.patch(
    `http://127.0.0.1:8000/rest/v1/household_members?id=eq.${id}`,
    { headers, data: { allergy_status: "unconfirmed" } },
  );
  if (!response.ok()) {
    throw new Error(`member safety update failed: ${String(response.status())}`);
  }
}
