/**
 * 週献立（Free）のロック導線。
 * 共有 storageState ユーザー（reusedCompletedPage）を使う。このユーザーは
 * 絶対に Plus に seed しない（billing-plus.spec.ts の weekly-plan-locked 前提と
 * 本ケースが同時に壊れるため）。
 */
import { expect, test } from "../fixtures/session-auth";

test("Free: locked preview → navigates to /plus", async ({ reusedCompletedPage }) => {
  const page = reusedCompletedPage;
  await page.goto("/planner");
  await expect(page.getByTestId("weekly-plan-locked")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("weekly-plan-locked").getByRole("link", { name: "Plus を見る" }).click();
  await expect(page).toHaveURL(/\/plus/u, { timeout: 15_000 });
});
