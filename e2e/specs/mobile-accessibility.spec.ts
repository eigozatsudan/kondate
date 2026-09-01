import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import {
  clickWizardNext,
  expectIdeaResultSurface,
  openFirstMemberEditor,
  seedGeneratedIdeaMenu,
  seedGeneratedMenu,
  selectHouseholdAudienceWithMember,
  setMockScenario,
} from "../fixtures/history";

const assertNoHorizontalScroll = async (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);

/**
 * Plan 7 契約: 主要 action は 44×44 CSS px 以上。native radio/checkbox は対象外。
 * 名前欠落を黙ってスキップすると偽 green になるため、必須コントロールは件数固定で検査する。
 * 呼び出し側は「その step で必ず存在する」ボタンだけを渡す。
 */
const assertMajorActionHeights = async (page: Page, required: Readonly<Record<string, number>>) => {
  for (const [name, expectedCount] of Object.entries(required)) {
    const control = page.getByRole("button", { name });
    await expect(control, `missing required control: ${name}`).toHaveCount(expectedCount);
    for (let index = 0; index < expectedCount; index += 1) {
      const box = await control.nth(index).boundingBox();
      expect(box, `${name}[${String(index)}] box`).not.toBeNull();
      expect(box?.height, `${name}[${String(index)}] height`).toBeGreaterThanOrEqual(44);
      expect(box?.width, `${name}[${String(index)}] width`).toBeGreaterThanOrEqual(44);
    }
  }
};

/** 横スクロール無し + 主要操作高さ。全 wizard step（review 含む）で使う。 */
const assertStepFits = async (page: Page, requiredMajors: Readonly<Record<string, number>>) => {
  await assertNoHorizontalScroll(page);
  await assertMajorActionHeights(page, requiredMajors);
};

/** 下書き autosave RPC 完了待ち（次へ前に必須）。 */
const waitDraftSave = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );

/**
 * household のみ: 既定 mock success が通るよう小麦ラベル確認を家族に載せる。
 * completedOnboardingPage 利用時、household wizard の前に1回呼ぶ。
 */
const ensureWheatMemberForMockSuccess = async (page: Page) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  // editorOpen 既定 false のため、呼び名入力前に編集フォームを開く
  await openFirstMemberEditor(page);
  // 編集ボタンの aria-label と部分一致しないよう textbox に限定する
  await page.getByRole("textbox", { name: "呼び名" }).fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  // Phase 4 §5b: 素の /planner はホーム着地（ウィザード hop は answerSharedWizardSteps 側）
  await page.goto("/planner");
};

/**
 * completedOnboardingPage は privacy 済み、ideaModePage は未。
 * privacy は openPrivacyNotice（flushDraft + resume=review）で SPA 復帰する。
 * フル reload で draft 巻き戻りを隠さない（製品退行を検出する）。
 * idea 生成前は setMockScenario が必要。
 */
const ensurePrivacyThenGenerate = async (
  page: Page,
  opts: { needsPrivacyHop: boolean; mockScenario?: string },
) => {
  if (opts.mockScenario) {
    await setMockScenario(page, opts.mockScenario);
  }
  const generate = page.getByRole("button", { name: "献立を作る" });
  if (opts.needsPrivacyHop) {
    // 未確認時も生成ボタンは有効（押下で説明 CTA へ誘導）。説明は secondary ボタン。
    await expect(generate).toBeEnabled();
    await page.getByRole("button", { name: "AI情報の説明を見る" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    // 共有は任意・既定 on（privacy-notice-page shareChecked 初期 true）。必須同意とは独立。
    await expect(
      page.getByRole("checkbox", { name: "匿名で緊急候補に役立ててよい" }),
    ).toBeChecked();
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/planner" && url.searchParams.get("resume") === "review",
    );
    await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  // 共有 AI 枠は suite/project 境界の shell のみ（並列 worker 下で test から truncate 禁止）
  await generate.click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 90_000,
  });
};

const answerSharedWizardSteps = async (page: Page) => {
  // Phase 4 §5b: ideaMode 等、ensureWheat を経由しない経路用のホーム経由ホップ（expect は 1 文字も変えない）
  await page.getByRole("button", { name: "今日の献立をつくる" }).click();
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
  await page.getByRole("radio", { name: "朝食" }).check();
  // meal: 選択後に「次へ」が必須
  await assertStepFits(page, { 次へ: 1 });
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await assertStepFits(page, { 追加: 1, 次へ: 1 });
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
  await page.getByRole("radio", { name: "和食" }).check();
  await assertStepFits(page, { 次へ: 1 });
  await clickWizardNext(page);
};

const answerAudienceAndReview = async (page: Page, mode: "household" | "idea") => {
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  // 設計 L9: DOM 順は人数だけ → 家族に合わせて
  const audienceRadios = page.getByRole("radio");
  await expect(audienceRadios.nth(0)).toHaveAccessibleName(/人数だけ指定してアイデアを見る/u);
  await expect(audienceRadios.nth(1)).toHaveAccessibleName(/家族に合わせて作る/u);
  if (mode === "idea") {
    const ideaSave = waitDraftSave(page);
    await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
    await page.getByRole("button", { name: "2人" }).click();
    expect((await ideaSave).ok()).toBe(true);
    await assertStepFits(page, { "2人": 1, 次へ: 1 });
  } else {
    // C-I4: メンバーは自動チェックされない。明示選択 + 成功 autosave を待つ。
    await selectHouseholdAudienceWithMember(page);
    await assertStepFits(page, { 次へ: 1 });
  }
  await clickWizardNext(page);

  // 任意4ページは既定の「指定なし」のまま「次へ」で送る。狭幅では 戻る/スキップ/次へ が並ぶ。
  await expect(page.getByRole("heading", { name: "5. 調理時間" })).toBeVisible();
  await assertStepFits(page, { 以降は指定なしでスキップ: 1, 戻る: 1, 次へ: 1 });
  await page.waitForTimeout(350);
  await clickWizardNext(page);

  for (const title of ["6. 予算", "7. 材料の使い方", "8. 献立の雰囲気"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await assertStepFits(page, { 戻る: 1, 次へ: 1 });
    await page.waitForTimeout(350);
    await clickWizardNext(page);
  }

  await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
  if (mode === "idea") {
    await expect(page.getByText("家族の年齢・アレルギーは確認されません")).toBeVisible();
  }
  // review 自身も meal〜audience と同様に横スクロール無しを要求する。
  // privacy 未了でも「献立を作る」は有効（押下で説明へ誘導）でコントロール自体は存在する。
  await assertStepFits(page, { 献立を作る: 1 });
};

for (const width of [320, 375, 430]) {
  // mobile project 専用。desktop 二重実行は config grepInvert で除外する。
  // PR smoke は 320px household wizard+result の 1 本だけ（§4.2）。
  test(
    `the household wizard and result fit ${String(width)}px with usable targets`,
    {
      tag: width === 320 ? ["@mobile-only", "@smoke"] : ["@mobile-only"],
    },
    async ({ completedOnboardingPage: page }) => {
      // wizard → generate → result の layout。生成待ち込みで既定 30s 不足。
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 800 });
      await ensureWheatMemberForMockSuccess(page);
      await assertNoHorizontalScroll(page);
      await answerSharedWizardSteps(page);
      await answerAudienceAndReview(page, "household");
      await ensurePrivacyThenGenerate(page, { needsPrivacyHop: false });
      await assertNoHorizontalScroll(page);
      await assertMajorActionHeights(page, { この献立にする: 1 });
    },
  );

  test(
    `the start screen fits ${String(width)}px with usable targets`,
    { tag: ["@mobile-only"] },
    async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/welcome");
      await assertNoHorizontalScroll(page);
      await assertMajorActionHeights(page, {
        献立アイデアを考える: 1,
        家族情報を登録する: 1,
      });
    },
  );

  test(
    `the idea wizard and result fit ${String(width)}px with usable targets`,
    { tag: ["@mobile-only"] },
    async ({ ideaModePage: page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 800 });
      await answerSharedWizardSteps(page);
      await answerAudienceAndReview(page, "idea");
      await ensurePrivacyThenGenerate(page, {
        needsPrivacyHop: true,
        mockScenario: "idea-servings-2",
      });
      await expectIdeaResultSurface(page);
      await assertNoHorizontalScroll(page);
      await assertMajorActionHeights(page, { この献立にする: 1, 注意事項を見る: 1 });
    },
  );

  // Global Constraints require 375/430 coverage beyond wizard: shell routes + both history modes.
  test(
    `shell routes fit ${String(width)}px with usable majors`,
    { tag: ["@mobile-only"] },
    async ({ completedOnboardingPage: page }) => {
      // 複数 path を順に walk。既定 30s では足りないことがある。
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 800 });
      // Live labels from src/app/layouts/app-shell.tsx — require exact counts (no silent skip).
      const shellNavLabels = ["献立", "冷蔵庫", "履歴", "買い物", "設定"] as const;
      for (const { path, heading } of [
        { path: "/pantry", heading: "食材リスト" },
        { path: "/shopping", heading: "買い物リスト" },
        { path: "/settings", heading: "家族設定" },
        // live history list h1 is 「作った献立」— not the nav label 「履歴」
        { path: "/history", heading: "作った献立" },
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
          timeout: 15_000,
        });
        await assertNoHorizontalScroll(page);
        const nav = page.getByRole("navigation", { name: "メインメニュー" });
        await expect(nav).toBeVisible();
        for (const name of shellNavLabels) {
          const item = nav.getByRole("link", { name, exact: true });
          await expect(item, `missing shell nav link: ${name} on ${path}`).toHaveCount(1);
          const box = await item.boundingBox();
          expect(box, name).not.toBeNull();
          expect(box?.height, `${name} height`).toBeGreaterThanOrEqual(44);
        }
      }
    },
  );

  test(
    `history detail both modes fit ${String(width)}px`,
    { tag: ["@mobile-only"] },
    async ({ completedOnboardingPage: page }) => {
      // household + idea の二重 seed と draft autosave 待ちのため 30s 既定では足りないことがある
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 800 });
      const householdId = await seedGeneratedMenu(page);
      await page.goto(`/history/${householdId}`);
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading").first()).not.toHaveAccessibleName("ホーム画面に置く");
      await assertNoHorizontalScroll(page);
      await page.goto("/planner");
      // history.ts: idea seed requires caller to set mock scenario (default success rejects idea).
      await setMockScenario(page, "idea-servings-2");
      const ideaId = await seedGeneratedIdeaMenu(page, 2);
      await page.goto(`/history/${ideaId}`);
      await expectIdeaResultSurface(page, { timeout: 30_000 });
      await assertNoHorizontalScroll(page);
    },
  );
}
