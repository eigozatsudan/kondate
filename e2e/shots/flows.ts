import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import {
  clickWizardNext,
  openFirstMemberEditor,
  openWizardFromHome,
  selectHouseholdAudienceWithMember,
} from "../fixtures/history";

/**
 * 家族に合わせた献立の条件をひととおり答えて「5. 確認」まで進める。
 * fixtures/history.ts の seedGeneratedMenu と同じ手順だが、
 * 「献立を作る」は押さずに止める（生成の成否を呼び出し側で作り分けるため）。
 */
export async function advanceToReviewWithHousehold(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  await openFirstMemberEditor(page);
  await page.getByRole("textbox", { name: "呼び名" }).fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();

  await openWizardFromHome(page);
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
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled({ timeout: 15_000 });
}

/**
 * 期限切れの食材を 1 件登録する（Phase 4 ホームの「期限が近い食材」枠を出すため）。
 * 期限日の入力欄は menu-domain-pantry.spec.ts:420 と同じ「期限日」ラベル。
 */
export async function addExpiredPantryItem(page: Page, name: string): Promise<void> {
  await page.goto("/pantry");
  await expect(page.getByRole("heading", { level: 1, name: "食材リスト" })).toBeVisible({
    timeout: 15_000,
  });
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/rest/v1/pantry_items"),
  );
  await page.getByRole("button", { name: "食材を追加" }).click();
  await page.getByRole("textbox", { name: "食材名" }).fill(name);
  await page.getByLabel("分量").fill("1");
  await page.getByLabel("単位").fill("丁");
  await page.getByLabel("期限日").fill("2000-01-01");
  await page.getByLabel("期限の種類").selectOption("use_by");
  await page.getByRole("button", { name: "追加する" }).click();
  await created;
}
