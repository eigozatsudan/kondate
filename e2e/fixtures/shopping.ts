import type { Page, Route } from "@playwright/test";
import { z } from "zod";
import { completeMinimumOnboarding, expect, test as authTest } from "./auth";
import { clickWizardNext } from "./history";
import { localRestHeaders } from "./local-supabase";

type ShoppingFixtures = { shoppingMenuId: string };

/**
 * 買い物リストジャーニー用。認証後にプランナーを使える状態へ整え、
 * 買い物リストの元になる献立を1件生成してその menuId を渡す。
 */
export const test = authTest.extend<ShoppingFixtures>({
  // Playwright の `use` コールバックは React の `use` フックと同名で
  // react-hooks/rules-of-hooks に抵触するため、既存の history.ts と同じく provide と命名する。
  // 設計書は authenticatedPage を起点にしているが、初回設定→AI説明同意の完了は
  // 既存の completedOnboardingPage が唯一グリーンな手順のためそちらを起点にする。
  // どちらも同一の Page インスタンスなので、spec 側の authenticatedPage 参照と一致する。
  shoppingMenuId: async ({ completedOnboardingPage: page }, provide) => {
    await ensurePlannerReady(page);
    await provide(await generateShoppingMenu(page));
  },
});
export { expect };

/**
 * 初回設定が残っていれば済ませたうえで、生成が実際に成立する家族条件を整えて
 * /planner を操作可能にする。
 *
 * mock の success fixture は小麦の原材料表示確認（labelConfirmation）を含むため、
 * アレルギー登録のない家族では検証が通らず生成が始まらない。既存の
 * history.ts `seedGeneratedMenu` と同じ条件（呼び名 + 小麦を登録あり）に揃える。
 */
export async function ensurePlannerReady(page: Page): Promise<void> {
  await page.goto("/planner");
  // 遷移直後は SPA が未 mount で isVisible() が常に false になり、初回設定が
  // 素通りされてしまう。初回設定かプランナー本体のどちらかが出るまで待ってから判定する。
  const onboardingHeading = page.getByRole("heading", { name: "家族の初回設定" });
  await expect(onboardingHeading.or(page.getByRole("radio", { name: "朝食" })).first()).toBeVisible(
    { timeout: 30_000 },
  );
  if (await onboardingHeading.isVisible()) {
    await completeMinimumOnboarding(page);
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
  }
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("呼び名").fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await page.goto("/planner");
  await expect(page.getByRole("radio", { name: "朝食" })).toBeVisible({ timeout: 30_000 });
}

/** 買い物リストの元になる献立を1件生成し、menuId を返す */
export async function generateShoppingMenu(page: Page): Promise<string> {
  await page.goto("/planner");
  // 設計書は「夕食」を指定するが、ローカルの OpenRouter mock が返す success fixture は
  // mealType=breakfast のため、夕食で要求すると生成が成立しない。既存の history.ts と
  // 同じく朝食で要求する（この読み替えは検証している内容を変えない）。
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
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  const parsed = /\/menus\/([0-9a-f-]+)$/u.exec(new URL(page.url()).pathname);
  if (parsed?.[1] === undefined) throw new Error("generated menu id was not present in URL");
  return parsed[1];
}

/** 献立結果画面から買い物リストを作成し、/shopping へ遷移させる */
export async function createListFromMenu(page: Page, menuId: string): Promise<void> {
  await page.goto(`/menus/${menuId}`);
  // 献立再検証と買い物安全ゲートが開くまで待つ（disabled のまま click すると 180s タイムアウトする）
  const createButton = page.getByRole("button", { name: "買い物リストを作る" });
  await expect(createButton).toBeEnabled({ timeout: 60_000 });
  await createButton.click();
  const newChoice = page.getByRole("radio", { name: "新しいリストにする" });
  if (await newChoice.isVisible()) await newChoice.check();
  await page.getByRole("button", { name: "作成する" }).click();
  await expect(page).toHaveURL(/\/shopping$/u);
  // 安全ゲート ready まで操作を開始しない（制御付き checkbox は gate 中 disabled）
  await expect(page.getByRole("checkbox", { name: /を購入済みにする/u }).first()).toBeEnabled({
    timeout: 60_000,
  });
}

/** 買い物リスト画面で手動項目を1件追加する */
export async function addManualItem(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "＋ 項目を追加" }).click();
  await page.getByLabel("項目名").fill(name);
  await page.getByLabel("売り場").selectOption("other");
  await page.getByRole("button", { name: "追加する" }).click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
}

/**
 * 次の generation POST だけに mock シナリオヘッダを付ける。
 * history.ts の setMockScenario と同型。再生成が success fixture と material 重複しない
 * alternate-menu を返すために必要（重複は「ほぼ同じ案」で失敗終端になる）。
 */
async function setMockScenario(page: Page, scenario: string): Promise<void> {
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

/** 履歴詳細から献立まるごとの別案を作り、新しい menuId を返す */
export async function regenerateWholeMenu(page: Page, menuId: string): Promise<string> {
  // 成功 fixture と material が重複しない別案を返す（history-regeneration と同じ）
  await setMockScenario(page, "alternate-menu");
  await page.goto(`/history/${menuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
  await page.getByRole("radio", { name: "別の味に" }).check();
  await page.getByRole("button", { name: "別案を作る" }).click();
  await expect(page).toHaveURL(new RegExp(`/menus/(?!${menuId})[0-9a-f-]{36}`, "iu"), {
    timeout: 90_000,
  });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  const parsed = /\/menus\/([0-9a-f-]+)$/u.exec(new URL(page.url()).pathname);
  if (parsed?.[1] === undefined) throw new Error("regenerated menu id was not present in URL");
  return parsed[1];
}

/** 献立の派生グループごと履歴を削除する（買い物リストの保持を確認するため） */
export async function deleteMenuHistoryGroup(page: Page, menuId: string): Promise<void> {
  const headers = await authenticatedRestHeaders(page);
  const lookup = await page.request.get(
    `http://127.0.0.1:8000/rest/v1/menus?id=eq.${menuId}&select=derivation_group_id`,
    { headers },
  );
  const rows = z.array(z.object({ derivation_group_id: z.uuid() })).parse(await lookup.json());
  if (rows[0] === undefined) throw new Error("menu group was not found");
  const removed = await page.request.post("http://127.0.0.1:8000/rest/v1/rpc/delete_menu_group", {
    headers,
    data: { p_derivation_group_id: rows[0].derivation_group_id },
  });
  if (!removed.ok()) throw new Error("menu group could not be deleted");
}

/**
 * パターンに一致するリクエストを保留させ、release() で解放するゲート。
 * 「再取得だけではゲートが開かない」ことを決定論的に観測するために使う。
 *
 * 設計書の `page.unrouteAll({ behavior: "wait" })` は、同時に2つの defer を張ると
 * 先に release した側がもう一方の pending handler 待ちでデッドロックする。
 * 自パターンだけ外し、continue は handler 側の1回だけにする。
 */
export async function deferMatchingRequest(
  page: Page,
  pattern: string,
): Promise<{
  release(): Promise<void>;
}> {
  let open: () => void = () => undefined;
  let seen: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    seen = resolve;
  });
  let released = false;
  let inFlight = 0;
  let notifyIdle: (() => void) | undefined;
  const markIdleIfNeeded = () => {
    if (inFlight === 0) notifyIdle?.();
  };

  const handler = async (route: Route) => {
    seen();
    inFlight += 1;
    try {
      if (!released) await gate;
      await route.continue();
    } catch {
      // unroute 直後の競合で既に settle 済みなら無視する
    } finally {
      inFlight -= 1;
      markIdleIfNeeded();
    }
  };
  await page.route(pattern, handler);
  return {
    release: async () => {
      await intercepted;
      released = true;
      const idle = new Promise<void>((resolve) => {
        notifyIdle = resolve;
        markIdleIfNeeded();
      });
      open();
      await idle;
      await page.unroute(pattern, handler);
    },
  };
}

/** 最初の complete メンバーを allergy_status=unconfirmed にして安全性を崩す */
export async function markFirstMemberAllergyUnconfirmed(page: Page): Promise<void> {
  const headers = await authenticatedRestHeaders(page);
  const lookup = await page.request.get(
    "http://127.0.0.1:8000/rest/v1/household_members?status=eq.complete&select=id&limit=1",
    { headers },
  );
  const rows = z.array(z.object({ id: z.uuid() })).parse(await lookup.json());
  if (rows[0] === undefined) throw new Error("complete household member was not found");
  const changed = await page.request.patch(
    `http://127.0.0.1:8000/rest/v1/household_members?id=eq.${rows[0].id}`,
    { headers, data: { allergy_status: "unconfirmed" } },
  );
  if (!changed.ok()) throw new Error("household safety could not be changed");
}

/**
 * 制御付き checkbox の購入済み切替。サーバー往復で isChecked が反映されるまで待つ。
 * Playwright の .check() はクリック直後に DOM が戻ると「state did not change」で落ちる。
 */
export async function markFirstItemPurchased(page: Page) {
  const checkbox = page.getByRole("checkbox", { name: /を購入済みにする/u }).first();
  await expect(checkbox).toBeEnabled({ timeout: 30_000 });
  await checkbox.click();
  await expect(checkbox).toBeChecked({ timeout: 15_000 });
  return checkbox;
}

async function authenticatedRestHeaders(page: Page): Promise<Record<string, string>> {
  return localRestHeaders(page);
}
