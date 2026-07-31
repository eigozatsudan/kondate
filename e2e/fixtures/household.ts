import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** 家族追加前の対象外事情ダイアログで「登録を続ける」を押す */
export async function confirmAddScopeNotice(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "登録の前に" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "登録を続ける" }).click();
  await expect(dialog).toHaveCount(0);
}
