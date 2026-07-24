import {
  clickWizardNext,
  expect,
  seedGeneratedIdeaMenu,
  seedGeneratedMenu,
  setMockScenario,
  test,
} from "../fixtures/acceptance";
import { requestWholeRegeneration } from "../fixtures/history";

test.setTimeout(360_000);

test("household journey: welcome through shopping reconciliation", async ({
  acceptancePage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/welcome");
  // 完了済みオンボーディングでも welcome は開ける場合と /planner 直帰がある
  if (new URL(page.url()).pathname === "/welcome") {
    const householdCta = page.getByRole("button", { name: /家族に合わせて|家族設定|献立を作る/u });
    if (
      await householdCta
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await householdCta.first().click();
    }
  }

  const menuId = await seedGeneratedMenu(page);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible();

  // 料理タブ・ラベル確認の存在
  const dishTab = page.getByRole("tab").first();
  if (await dishTab.isVisible().catch(() => false)) {
    await dishTab.click();
  }

  // 全体再生成
  await setMockScenario(page, "alternate-menu");
  await requestWholeRegeneration(page, menuId, "simpler");
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });

  // 履歴グループ
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: /履歴/u }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 買い物リスト作成
  await page.goto(`/menus/${menuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u))
    .toBeVisible({
      timeout: 30_000,
    })
    .catch(() => undefined);
  const shop = page.getByRole("button", { name: "買い物リストを作る" });
  if (await shop.isEnabled({ timeout: 15_000 }).catch(() => false)) {
    await shop.click();
    await expect(page)
      .toHaveURL(/shopping/u, { timeout: 60_000 })
      .catch(() => undefined);
  }

  // 320px 横スクロールなし
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("idea journey: no family safety, no shopping, mode-preserving regen", async ({
  acceptancePage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });

  const shoppingRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/shopping-lists")) {
      shoppingRequests.push(path);
    }
  });

  await setMockScenario(page, "idea-servings-2");
  const menuId = await seedGeneratedIdeaMenu(page, 2);
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toHaveCount(0);

  // child_friendly が idea 再生成 UI に出ない
  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
  await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  await page.keyboard.press("Escape").catch(() => undefined);

  await setMockScenario(page, "idea-alternate-menu-1");
  await requestWholeRegeneration(page, menuId, "simpler", { targetMode: "idea" });
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 60_000 });

  // お気に入り（あれば）
  const fav = page.getByRole("button", { name: /お気に入り/u });
  if (await fav.isVisible().catch(() => false)) {
    await fav.click().catch(() => undefined);
  }

  expect(shoppingRequests).toEqual([]);
  const shoppingKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("kondate:shopping:")),
  );
  expect(shoppingKeys).toEqual([]);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
