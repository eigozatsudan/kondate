import type { Route } from "@playwright/test";
import { expect, test } from "../fixtures/history";
import { advanceToReviewWithHousehold } from "./flows";
import { shot } from "./shot";

const DIR = "phase-2-shots";

/** 生成中（data-phase="processing"）: POST 応答を保留して進捗メーターを撮る。 */
test("generating", async ({ completedOnboardingPage: page }) => {
  await advanceToReviewWithHousehold(page);

  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/generations/menu", async (route: Route) => {
    await held;
    await route.continue();
  });
  // status も止めないと、進捗表示に留まらず結果へ抜けることがある。
  await page.route("**/api/generations/*/status", async (route: Route) => {
    await held;
    await route.continue();
  });

  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page).toHaveURL(/\/generation/u, { timeout: 30_000 });
  // 体感段階が 1 段以上進んだところを撮る（0 段目は瞬間的で誌面として意味が薄い）。
  await page.waitForTimeout(4_000);
  await shot(page, DIR, "generation-processing");

  release?.();
});

/** 成功: 生成直後の結果画面（surface=generation）。 */
test("succeeded", async ({ completedOnboardingPage: page }) => {
  await advanceToReviewWithHousehold(page);
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, DIR, "generation-succeeded");
});

/**
 * 失敗（data-phase="failed"）: ok:false + draft_not_found を返す。
 * draft_not_found は POST_ERROR_STATUS_RECOVERABLE_FAILURE_CODES に含まれない
 * pre-reserve 系コードなので、offline ではなく failed に落ちる
 * （use-generation-recovery.ts:107-135）。
 */
test("failed", async ({ completedOnboardingPage: page }) => {
  await advanceToReviewWithHousehold(page);
  await page.route("**/api/generations/menu", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "draft_not_found", message: "下書きが見つかりません" },
      }),
    });
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page.locator('[data-phase="failed"]')).toBeVisible({ timeout: 30_000 });
  await shot(page, DIR, "generation-failed");
});

/**
 * オフライン（data-phase="offline"）: handler 完了後に応答だけ捨て、
 * 回収用の status も切る。generation-recovery-results.spec.ts:245-280 と同じ作り方。
 */
test("offline", async ({ completedOnboardingPage: page }) => {
  await advanceToReviewWithHousehold(page);
  await page.route("**/api/generations/menu", async (route: Route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "X-Kondate-E2E-Drop-Response": "after-handler",
      },
    });
  });
  await page.route("**/api/generations/*/status", async (route: Route) => {
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page.getByText("通信を確認しています")).toBeVisible({ timeout: 30_000 });
  await shot(page, DIR, "generation-offline");
});
