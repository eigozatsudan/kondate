import {
  addManualItem,
  createListFromMenu,
  deleteMenuHistoryGroup,
  expect,
  markFirstItemPurchased,
  regenerateWholeMenu,
  test,
} from "../fixtures/shopping";

// 献立生成を伴うため既定の30秒では足りない（既存の履歴系specと同じ扱い）。
test.setTimeout(180_000);

test("retains checked/manual items and label snapshots after history deletion", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  const first = await markFirstItemPurchased(page);
  await addManualItem(page, "キッチンペーパー");
  await deleteMenuHistoryGroup(page, shoppingMenuId);
  await page.goto("/shopping");
  await expect(page.getByText("キッチンペーパー")).toBeVisible();
  await expect(first).toBeChecked();
  await expect(page.getByText("現在の条件では確認できない過去の警告")).toBeVisible();
  await expect(page.getByText("加工品は原材料表示を確認")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "＋ 項目を追加" })).toBeDisabled();
});

test("shows server-owned diff and preserves protected rows", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  const checked = await markFirstItemPurchased(page);
  const nextMenuId = await regenerateWholeMenu(page, shoppingMenuId);
  await page.goto(`/menus/${nextMenuId}`);
  await page.getByRole("button", { name: "買い物リストとの差分を確認" }).click();
  await expect(page.getByText("購入済み・手動変更の項目はそのまま残します。")).toBeVisible();
  await page.getByRole("button", { name: "選んだ変更を反映" }).click();
  await page.goto("/shopping");
  await expect(checked).toBeChecked();
});
