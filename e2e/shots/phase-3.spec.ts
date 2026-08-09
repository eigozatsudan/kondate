import { expect, seedGeneratedIdeaMenu, seedGeneratedMenu, test } from "../fixtures/history";
import { shot } from "./shot";

const DIR = "phase-3-shots";

/** 家庭向けの献立詳細（生成直後 surface）と、履歴からたどった同じ献立の詳細。 */
test("household menu detail and history", async ({ completedOnboardingPage: page }) => {
  await seedGeneratedMenu(page);
  await shot(page, DIR, "menu-detail-household");

  await page.goto("/history");
  await expect(page.getByRole("heading", { level: 1, name: "作った献立" })).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, DIR, "history-list");

  await page.getByRole("link", { name: "詳細を見る" }).first().click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "全体の段取り" })).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, DIR, "history-detail");
});

/** アイデア献立の詳細（家族安全確認を出さない surface）。 */
test("idea menu detail", async ({ ideaModePage: page }) => {
  // seedGeneratedIdeaMenu は結果画面まで進み、expectIdeaResultSurface で着地を確認する。
  await seedGeneratedIdeaMenu(page);
  await shot(page, DIR, "menu-detail-idea");
});
