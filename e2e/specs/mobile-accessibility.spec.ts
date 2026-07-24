import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import {
  clickWizardNext,
  seedGeneratedIdeaMenu,
  seedGeneratedMenu,
  setMockScenario,
} from "../fixtures/history";

const assertNoHorizontalScroll = async (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);

/**
 * Plan 7 contract: major action buttons' height ≥ 44. Native radios/checkboxes are out of scope.
 * Never silently skip a missing name — that turns a missing primary control into a false green.
 * Callers pass only buttons that **must** exist in the current route × mode × step; use
 * `assertMajorActionHeights(page, { "次へ": 1 })` form when a single instance is required.
 */
const assertMajorActionHeights = async (page: Page, required: Readonly<Record<string, number>>) => {
  for (const [name, expectedCount] of Object.entries(required)) {
    const control = page.getByRole("button", { name });
    await expect(control, `missing required control: ${name}`).toHaveCount(expectedCount);
    for (let index = 0; index < expectedCount; index += 1) {
      const box = await control.nth(index).boundingBox();
      expect(box, `${name}[${String(index)}] box`).not.toBeNull();
      expect(box?.height, `${name}[${String(index)}] height`).toBeGreaterThanOrEqual(44);
    }
  }
};

/** Per-step required majors — do not pass a union of every wizard button on every step. */
const assertStepFits = async (page: Page, requiredMajors: Readonly<Record<string, number>>) => {
  await assertNoHorizontalScroll(page);
  await assertMajorActionHeights(page, requiredMajors);
};

/** Wait for draft RPC after a wizard field change (required before 次へ). */
const waitDraftSave = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft"),
  );

/**
 * Household only: make default mock success valid (wheat label confirmations).
 * Call once before the household wizard when using completedOnboardingPage.
 */
const ensureWheatMemberForMockSuccess = async (page: Page) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("呼び名").fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  await page.goto("/planner");
};

/**
 * completedOnboardingPage already has privacy; ideaModePage does not.
 * After privacy return, reload is mandatory (same as history.ts seedGeneratedIdeaMenu).
 * ideaMode requires setMockScenario before POST.
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
    await expect(generate).toBeDisabled();
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
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 90_000,
  });
};

const answerSharedWizardSteps = async (page: Page) => {
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
  await page.getByRole("radio", { name: "朝食" }).check();
  // meal step: 次へ required after selection
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
  if (mode === "idea") {
    const ideaSave = waitDraftSave(page);
    await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
    await page.getByRole("button", { name: "2人" }).click();
    expect((await ideaSave).ok()).toBe(true);
    await assertStepFits(page, { "2人": 1, 次へ: 1 });
  } else {
    const householdSave = waitDraftSave(page);
    await page.getByRole("radio", { name: "家族に合わせて作る" }).check();
    await expect(page.getByRole("checkbox", { name: /家族1/u })).toBeChecked();
    expect((await householdSave).ok()).toBe(true);
    await assertStepFits(page, { 次へ: 1 });
  }
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  if (mode === "idea") {
    await expect(page.getByText("家族の年齢・アレルギーは確認されません")).toBeVisible();
  }
  // review may show 献立を作る disabled until privacy; still require the control to exist
  await assertMajorActionHeights(page, { 献立を作る: 1 });
};

for (const width of [320, 375, 430]) {
  test(`the household wizard and result fit ${String(width)}px with usable targets`, async ({
    completedOnboardingPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await ensureWheatMemberForMockSuccess(page);
    await assertNoHorizontalScroll(page);
    await answerSharedWizardSteps(page);
    await answerAudienceAndReview(page, "household");
    await ensurePrivacyThenGenerate(page, { needsPrivacyHop: false });
    await assertNoHorizontalScroll(page);
    await assertMajorActionHeights(page, { これに決めた: 1 });
  });

  test(`the start screen fits ${String(width)}px with usable targets`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/welcome");
    await assertNoHorizontalScroll(page);
    await assertMajorActionHeights(page, {
      献立アイデアを考える: 1,
      家族情報を登録する: 1,
    });
  });

  test(`the idea wizard and result fit ${String(width)}px with usable targets`, async ({
    ideaModePage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await answerSharedWizardSteps(page);
    await answerAudienceAndReview(page, "idea");
    await ensurePrivacyThenGenerate(page, {
      needsPrivacyHop: true,
      mockScenario: "idea-servings-2",
    });
    await expect(page.getByText("家族条件を使用していません")).toBeVisible();
    await assertNoHorizontalScroll(page);
    await assertMajorActionHeights(page, { これに決めた: 1 });
  });

  // Global Constraints require 375/430 coverage beyond wizard: shell routes + both history modes.
  test(`shell routes fit ${String(width)}px with usable majors`, async ({
    completedOnboardingPage: page,
  }) => {
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
  });

  test(`history detail both modes fit ${String(width)}px`, async ({
    completedOnboardingPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const householdId = await seedGeneratedMenu(page);
    await page.goto(`/history/${householdId}`);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 30_000 });
    await assertNoHorizontalScroll(page);
    await page.goto("/planner");
    // history.ts: idea seed requires caller to set mock scenario (default success rejects idea).
    await setMockScenario(page, "idea-servings-2");
    const ideaId = await seedGeneratedIdeaMenu(page, 2);
    await page.goto(`/history/${ideaId}`);
    await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 30_000 });
    await assertNoHorizontalScroll(page);
  });
}
