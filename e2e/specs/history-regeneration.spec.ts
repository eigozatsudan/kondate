import {
  expect,
  readRemainingQuota,
  requestWholeRegeneration,
  seedGeneratedMenu,
  setMockScenario,
  test,
} from "../fixtures/history";

// 認証・生成・再生成・再検証を直列で含むため既定 30s では足りない
test.setTimeout(180_000);

test("regenerates whole menu, groups versions, and marks the chosen menu", async ({
  historyPage: page,
}) => {
  const sourceMenuId = await seedGeneratedMenu(page);
  // 成功 fixture と material 重複しない別案を返す
  await setMockScenario(page, "alternate-menu");
  await requestWholeRegeneration(page, sourceMenuId, "simpler");
  // 成功時は /menus/:newId へ着地する（?recovered=1 付きも可）
  await expect(page).toHaveURL(new RegExp(`/menus/(?!${sourceMenuId})[0-9a-f-]{36}`, "iu"), {
    timeout: 60_000,
  });
  await expect(page.getByText("献立ができました")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "これに決めた" }).click();
  await page.goto("/history");
  await expect(page.getByText("2案")).toBeVisible({ timeout: 15_000 });
});

test("does not consume a success for duplicate output", async ({ historyPage: page }) => {
  const menuId = await seedGeneratedMenu(page);
  await setMockScenario(page, "duplicate-menu");
  const before = await readRemainingQuota(page);
  await requestWholeRegeneration(page, menuId, "different_flavor");
  // 重複は failed 終端で生成画面に留まる（成功遷移しない）
  await expect(page).toHaveURL(/\/generation/u, { timeout: 30_000 });
  await expect(
    page.getByText("元の献立とほぼ同じ案だったため保存しませんでした。今回は回数に含まれません"),
  ).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => readRemainingQuota(page), { timeout: 15_000 }).toBe(before);
});
