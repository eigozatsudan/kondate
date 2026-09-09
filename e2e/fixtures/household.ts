import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** 家族追加前の対象外事情ダイアログで「登録を続ける」を押す */
export async function confirmAddScopeNotice(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "登録の前に" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "登録を続ける" }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * settings の「この家族の設定を完了」を、アレルギー一覧が確定してから押す。
 * 2人目 draft は query key 切替直後に listAllergies が pending になり、H5 関門が
 * complete_household_member を飛ばさず field alert だけ出す。selectOption は
 * select の enabled を待つが、完了直前の refetch（空 cache + isFetching）は
 * 待たないため、未確認警告が消えるまで同期する。
 */
export async function completeHouseholdMemberWhenAllergiesReady(page: Page): Promise<void> {
  await expect(page.getByLabel("アレルギーの確認")).toBeEnabled({ timeout: 15_000 });
  await expect(
    page.getByText(/アレルギー一覧を確認できないため、以前の登録が残っている可能性/u),
  ).toHaveCount(0, { timeout: 15_000 });
  const memberCompleted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/rpc/complete_household_member"),
  );
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();
  expect((await memberCompleted).ok()).toBe(true);
}
