import type { Page, Route } from "@playwright/test";
import { z } from "zod";
import { expect, test as authTest } from "./auth";
import { confirmAddScopeNotice } from "./household";
import { accessTokenFromPage, localRestHeaders } from "./local-supabase";
import { resetGlobalAiQuotaForE2e } from "./reset-global-ai-quota";

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
 * wizard の「次へ」を押す。
 * fixed bottom-nav にボタンが隠れる退行を検出するため、DOM 直接 click() は使わない。
 * scroll → ナビより上にあること → Playwright actionability click の順で、
 * 実機タッチと同様に遮蔽されていれば失敗する。
 */
export async function clickWizardNext(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "次へ" });
  await expect(next).toBeVisible();
  // save_generation_draft の HTTP 成功直後でも、React が isSaving を落とす前に
  // 押すと disabled のまま throw する（menu-domain-pantry 長尺で再現）。
  await expect(next).toBeEnabled({ timeout: 15_000 });
  // fixed bottom-nav を考慮して中央付近へ。IfNeeded だけだとナビ下に居たまま「見えた」扱いになる。
  await next.evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });
  // 固定 bottom-nav（min-height 56px）より上にボタン下端があることを固定する
  const clearance = await next.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav");
    if (!(nav instanceof HTMLElement)) {
      return { ok: true as const, bottom: rect.bottom, navTop: null };
    }
    const navTop = nav.getBoundingClientRect().top;
    return { ok: rect.bottom <= navTop + 1, bottom: rect.bottom, navTop };
  });
  expect(
    clearance.ok,
    `wizard next is occluded by bottom-nav (button.bottom=${String(clearance.bottom)}, nav.top=${String(clearance.navTop)})`,
  ).toBe(true);
  // force: false（既定）: 他要素に遮られていれば click 自体が失敗する
  await next.click();
}

/**
 * C-I4: 「家族に合わせて作る」はメンバーを自動選択しない。
 * household + 0 members は save_generation_draft の DB CHECK で拒否されるため、
 * eligible メンバーを明示チェックし、member_ids 非空の成功 POST を同期点にする。
 * radio のみの失敗 POST は body で除外する。
 */
export async function selectHouseholdAudienceWithMember(
  page: Page,
  memberName: RegExp = /家族1/u,
): Promise<void> {
  await page.getByRole("radio", { name: "家族に合わせて作る" }).check();
  const member = page.getByRole("checkbox", { name: memberName });
  await expect(member).toBeVisible();
  // 復元済みdraftなどで目的のメンバーが選択済みなら、新しい保存操作は発生しない。
  // response waiterを作る前に完了し、存在しないPOSTを待ち続けない。
  if (await member.isChecked()) return;
  // メンバー確定後の成功保存だけを待つ（radio 単独の CHECK 失敗 POST は無視）
  const audienceSaveResponse = page.waitForResponse((response) => {
    if (response.request().method() !== "POST") return false;
    if (!new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft")) {
      return false;
    }
    const postData = response.request().postData();
    if (postData === null) return false;
    try {
      const body = JSON.parse(postData) as { p_target_member_ids?: unknown };
      return Array.isArray(body.p_target_member_ids) && body.p_target_member_ids.length > 0;
    } catch {
      return false;
    }
  });
  await member.check();
  expect((await audienceSaveResponse).ok()).toBe(true);
}

/** 登録済み一覧のみのとき編集フォームを開く（editorOpen 既定 false 対応） */
export async function openFirstMemberEditor(page: Page): Promise<void> {
  const nameField = page.getByRole("textbox", { name: "呼び名" });
  if (await nameField.isVisible().catch(() => false)) return;
  const edit = page.getByRole("button", { name: /を編集$/u }).first();
  if ((await edit.count()) > 0) {
    await edit.click();
  } else {
    await page.getByRole("button", { name: "家族を追加" }).click();
    await confirmAddScopeNotice(page);
  }
  await expect(nameField).toBeVisible({ timeout: 15_000 });
}

/** page ごとの sticky mock scenario handler（clear / 差し替えまで維持） */
type MockScenarioBinding = {
  match: (url: URL | string) => boolean;
  handler: (route: Route) => Promise<void>;
};
const mockScenarioByPage = new WeakMap<Page, MockScenarioBinding>();

/**
 * sticky mock シナリオを外す。setMockScenario 差し替え前や明示クリア用。
 */
export async function clearMockScenario(page: Page): Promise<void> {
  const existing = mockScenarioByPage.get(page);
  if (existing === undefined) return;
  await page.unroute(existing.match, existing.handler);
  mockScenarioByPage.delete(page);
}

/**
 * generation POST に mock シナリオヘッダを付ける（Compose mock 時のみサーバが尊重）。
 * recovery / connectionreset 再送 / 二重 submit でも外れない sticky。
 * clearMockScenario または別 scenario の setMockScenario 差し替えまで維持する。
 * GET で吸われないよう POST のみヘッダ付与。
 * 呼び出し側は fixture 固有の中身（料理名等）を assert し、吸込み偽 green を防ぐこと。
 */
export async function setMockScenario(page: Page, scenario: string): Promise<void> {
  await clearMockScenario(page);
  const matchGeneration = (url: URL | string): boolean => {
    const path = new URL(url).pathname;
    return path === "/api/generations/menu" || path === "/api/generations/dish";
  };
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    // sticky: unroute しない。再送でも同一 scenario を付け続ける（E2E7）
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-kondate-mock-scenario": scenario,
      },
    });
  };
  mockScenarioByPage.set(page, { match: matchGeneration, handler });
  await page.route(matchGeneration, handler);
}

/**
 * 固定 success fixture と整合する条件で献立を1件生成し、menuId を返す。
 */
export async function seedGeneratedMenu(page: Page): Promise<string> {
  // スイート後半で GLOBAL 20 に当たらないよう、生成直前に共有枠だけ空にする
  await resetGlobalAiQuotaForE2e();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({
    timeout: 15_000,
  });
  // editorOpen 既定 false のため、呼び名入力前に編集フォームを開く
  await openFirstMemberEditor(page);
  // 編集ボタンの aria-label と部分一致しないよう textbox に限定する
  await page.getByRole("textbox", { name: "呼び名" }).fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible({
    timeout: 15_000,
  });
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
  await selectHouseholdAudienceWithMember(page);
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

type RegenerationReason =
  "simpler" | "different_ingredient" | "child_friendly" | "different_flavor";

const regenerationReasonLabel: Record<RegenerationReason, string> = {
  simpler: "もっと簡単に",
  different_ingredient: "別の食材で",
  child_friendly: "子どもが食べやすく",
  different_flavor: "別の味に",
};

/**
 * 結果画面へ移動し、mode 別の準備表示（家族再検証 or idea notice）を待つ。
 */
async function openMenuResultForRegeneration(
  page: Page,
  menuId: string,
  targetMode: "household" | "idea",
): Promise<void> {
  await page.goto(`/menus/${menuId}`);
  if (targetMode === "household") {
    await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({
      timeout: 30_000,
    });
  } else {
    await expectIdeaResultSurface(page, { timeout: 30_000 });
  }
}

/**
 * idea 結果・履歴詳細の注意喚起（InlineNotice）が出ていることを待つ。
 * 設計 §5.4 の必須2文は常時表示。AI/ラベル長文はダイアログ側。
 */
export async function expectIdeaResultSurface(
  page: Page,
  options: { timeout?: number } = {},
): Promise<void> {
  const timeout = options.timeout ?? 30_000;
  await expect(page.getByText("ご確認ください")).toBeVisible({ timeout });
  // dialog 外の常時表示（§5.4）。最初の可視ノードで足りる
  await expect(page.getByText("家族条件を使用していません").first()).toBeVisible({ timeout });
  await expect(page.getByText("年齢・アレルギーへの適合は確認されていません").first()).toBeVisible({
    timeout,
  });
  await expect(page.getByRole("button", { name: "注意事項を見る" })).toBeVisible({ timeout });
}

/**
 * idea 詳細ダイアログを開き、AI/ラベル長文を含む固定文言を確認する。
 * 必須2文は常時表示側にもあるが、dialog 内コピーも合わせて検証する。
 */
export async function openAndAssertIdeaSafetyDetails(page: Page): Promise<void> {
  await page.getByRole("button", { name: "注意事項を見る" }).click();
  const dialog = page.getByRole("dialog", { name: "この献立はアイデアとして作成しました" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("家族条件を使用していません")).toBeVisible();
  await expect(dialog.getByText("年齢・アレルギーへの適合は確認されていません")).toBeVisible();
  await expect(dialog.getByText(/AIが作成した献立です/u)).toBeVisible();
  await expect(
    dialog.getByText(
      "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
    ),
  ).toBeVisible();
}

/**
 * 再生成シートで理由を選び、source 以外の /generation または /menus へ遷移するまで待つ。
 * idea では child_friendly が DOM に無いことも同時に検証する。
 */
async function submitRegenerationSheet(
  page: Page,
  menuId: string,
  reason: RegenerationReason,
  targetMode: "household" | "idea",
): Promise<void> {
  if (targetMode === "idea") {
    await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  }
  await page.getByRole("radio", { name: regenerationReasonLabel[reason] }).check();
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
 * 結果画面（/menus または /history）から献立全体の再生成を開始する。
 * クリック後、生成完了または失敗画面への遷移を待つ。
 * household は家族再検証の完了を待ち、idea は notice 表示を待つ。
 */
export async function requestWholeRegeneration(
  page: Page,
  menuId: string,
  reason: RegenerationReason,
  options: { targetMode?: "household" | "idea" } = {},
): Promise<void> {
  const targetMode = options.targetMode ?? "household";
  // 結果画面の再生成コントロールを使う（履歴詳細と同等の UI）
  await openMenuResultForRegeneration(page, menuId, targetMode);
  await expect(page.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "この案を元に別の献立を作り直す" }).click();
  await submitRegenerationSheet(page, menuId, reason, targetMode);
}

/**
 * 結果画面から一品再生成を開始する。既定で先頭料理（主菜）を対象にする。
 * idea は notice 表示後に sheet を開き、child_friendly 非表示を確認する。
 */
export async function requestDishRegeneration(
  page: Page,
  menuId: string,
  reason: RegenerationReason,
  options: { targetMode?: "household" | "idea" } = {},
): Promise<void> {
  const targetMode = options.targetMode ?? "household";
  await openMenuResultForRegeneration(page, menuId, targetMode);
  await expect(page.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "この一品だけ別案にする" }).click();
  await submitRegenerationSheet(page, menuId, reason, targetMode);
}

/**
 * idea モードで1件生成し menuId を返す。
 * completed/skipped 利用者でも /planner から idea 対象を選んで生成できる。
 * mock scenario は呼び出し側で setMockScenario する。
 */
export async function seedGeneratedIdeaMenu(page: Page, servings: 1 | 2 | 20 = 2): Promise<string> {
  await resetGlobalAiQuotaForE2e();
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
    await page.getByLabel("7人以上（20人まで）").selectOption(String(servings));
  }
  expect((await ideaSave).ok()).toBe(true);
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  // privacy 未了では説明 CTA が見える（生成ボタンは案内のため有効のまま）。
  // openPrivacyNotice は flushDraft + resume=review で戻る。本番はフル reload しないため
  // SPA 復帰だけで review を維持することを主張する（巻き戻りは製品退行として失敗させる）。
  const privacyCta = page.getByRole("button", { name: "AI情報の説明を見る" });
  if (await privacyCta.isVisible().catch(() => false)) {
    await privacyCta.click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/planner" && url.searchParams.get("resume") === "review",
    );
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 60_000 });
  await expectIdeaResultSurface(page, { timeout: 30_000 });
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

/**
 * 保存済み献立の材料名を標準アレルゲン語へ書き換えて、revalidate が
 * direct_allergen_match（status=invalid）を返す状態を作る。
 * dish_ingredients は authenticated に UPDATE が無いため、service DB（pg）で注入する。
 * seedGeneratedMenu は小麦登録済みのため、既定の「小麦粉」で直接 hit する。
 */
export async function injectDirectAllergenHit(
  page: Page,
  menuId: string,
  allergenText = "小麦粉",
): Promise<void> {
  const parsedMenuId = z.uuid().parse(menuId);
  // page 引数は呼び出し対称性のため受け取るが、ブラウザへ secret を渡さない
  void page;
  const { readFile } = await import("node:fs/promises");
  const { Client } = await import("pg");
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const password = z
    .string()
    .min(1)
    .parse(/^POSTGRES_PASSWORD=(.+)$/mu.exec(envText)?.[1]?.trim());
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:54322/postgres?sslmode=disable`,
  });
  await client.connect();
  try {
    const result = await client.query(
      `update public.dish_ingredients
         set name = $1
       where id = (
         select id from public.dish_ingredients
         where menu_id = $2::uuid
         order by position asc
         limit 1
       )
       returning id`,
      [allergenText, parsedMenuId],
    );
    if (result.rowCount !== 1) {
      throw new Error(`direct allergen inject updated ${String(result.rowCount)} rows`);
    }
  } finally {
    await client.end();
  }
}
