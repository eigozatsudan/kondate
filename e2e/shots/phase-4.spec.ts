import type { Page, Route } from "@playwright/test";
import { expect, seedGeneratedMenu, test } from "../fixtures/history";
import { addExpiredPantryItem, advanceToReviewWithHousehold } from "./flows";
import { shot } from "./shot";

const DIR = "phase-4-shots";

const expectHome = async (page: Page): Promise<void> => {
  await expect(page.getByRole("button", { name: "今日の献立をつくる" })).toBeVisible({
    timeout: 30_000,
  });
};

/** 通常時: 下書きも pending も無い素の /planner。直近の献立が 1 件並んだ状態も撮る。 */
test("home default", async ({ completedOnboardingPage: page }) => {
  await page.goto("/planner");
  await expectHome(page);
  await shot(page, DIR, "home-default");

  await seedGeneratedMenu(page);
  await page.goto("/planner");
  await expectHome(page);
  await shot(page, DIR, "home-with-recent-menu");
});

/**
 * 生成中断あり。
 *
 * 完全回答済み下書き（firstIncomplete === "review"）が残っていても、resumable pending
 * があるときはホームを優先し、HomeGenerateCard の「作成中の献立を続ける」を最上位に出す。
 * （?resume= 付きの深リンクはウィザードのまま — 不変契約 4b）
 */
test("planner after an interrupted generation", async ({ completedOnboardingPage: page }) => {
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

  await page.goto("/planner");
  await expect(page.getByRole("button", { name: "作成中の献立を続ける" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/作成中の献立があります/u)).toBeVisible();
  await shot(page, DIR, "planner-after-interrupted-generation");
});

/** 期限切れ食材あり: ホームの「期限が近い食材」枠に Badge が出た状態。 */
test("home with expired pantry item", async ({ completedOnboardingPage: page }) => {
  await addExpiredPantryItem(page, "撮影用の豆腐");
  await page.goto("/planner");
  await expectHome(page);
  await shot(page, DIR, "home-expiring-pantry");
});
