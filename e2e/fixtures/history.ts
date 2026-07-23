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
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
  await page.getByRole("radio", { name: "和食" }).check();
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  const audienceSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );
  await page.getByRole("radio", { name: "家族に合わせて作る" }).check();
  expect((await audienceSaveResponse).ok()).toBe(true);
  await page.getByRole("button", { name: "次へ" }).click();
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
 */
export async function requestWholeRegeneration(
  page: Page,
  menuId: string,
  reason: "simpler" | "different_ingredient" | "child_friendly" | "different_flavor",
): Promise<void> {
  // 結果画面の再生成コントロールを使う（履歴詳細と同等の UI）
  await page.goto(`/menus/${menuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
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
