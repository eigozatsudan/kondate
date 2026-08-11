import { expect, test as base, type Page } from "@playwright/test";

/** setup project が書き込む storageState のパス（gitignore 対象） */
export const STORAGE_STATE_PATH = "e2e/.auth/user.json";

type SessionAuthFixtures = {
  /**
   * setup 済み storageState を読んだ page。
   * onboarding は seed 済み。welcome 振り分け検証には使わない。
   * 破壊的 / ユーザ isolation 必須の test は auth.ts の ephemeral 系を使う。
   */
  reusedCompletedPage: Page;
};

/**
 * 読み取り中心・同一ユーザでよい UI 用の fixture。
 * seed / magic-link は setup project が済ませているので、ここでは context 復元のみ。
 */
export const test = base.extend<SessionAuthFixtures>({
  reusedCompletedPage: async ({ browser }, provide) => {
    // 既定 page は storageState 無しのため、専用 context を開く
    const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
    const page = await context.newPage();
    // seed 済みセッションで planner に立てることを固定（welcome へ戻らない）
    await page.goto("/planner");
    await expect(page).toHaveURL((url) => url.pathname === "/planner", { timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible({
      timeout: 15_000,
    });
    await provide(page);
    await context.close();
  },
});

export { expect };
