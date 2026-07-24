import { clickWizardNext, expect, setMockScenario, test } from "../fixtures/acceptance";
import { requestWholeRegeneration } from "../fixtures/history";

test.setTimeout(360_000);

/**
 * household 受け入れジャーニー。seed helper で献立生成を短絡しない。
 * welcome →（必要なら）設定完了 → planner wizard → privacy → generate →
 * label/tab → whole regen → history → accept → shopping create を実操作で通す。
 */
test("household journey: welcome through shopping reconciliation", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });

  // 小麦ラベル確認が必要な mock success 用メンバーを整える
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("呼び名").fill("家族1");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await page.getByRole("button", { name: "小麦を追加" }).click();
  await page.getByRole("button", { name: "この家族の設定を完了" }).click();

  // completedOnboardingPage は onboarding_status=complete のため /welcome は
  // WelcomePage 契約どおり /planner へ即時リダイレクトする。welcome 見出しは期待しない。
  await page.goto("/planner");
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible({ timeout: 15_000 });
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
  await page.getByRole("radio", { name: "家族に合わせて作る" }).check();
  await expect(page.getByRole("checkbox", { name: /家族1/u })).toBeChecked();
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  // privacy 未了なら説明へ
  const generate = page.getByRole("button", { name: "献立を作る" });
  if (await generate.isDisabled().catch(() => false)) {
    await page.getByRole("button", { name: "AI情報の説明を見る" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await page.reload();
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({ timeout: 15_000 });
  }
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({ timeout: 30_000 });

  const menuUrl = page.url();
  const menuId = /\/menus\/([0-9a-f-]{36})/iu.exec(menuUrl)?.[1];
  expect(menuId).toBeTruthy();

  // 料理タブ
  const dishTab = page.getByRole("tab").first();
  await expect(dishTab).toBeVisible();
  await dishTab.click();

  // ラベル確認 UI が存在すれば操作（pending が無い fixture もあり得る）
  const labelConfirm = page.getByRole("button", {
    name: "本人が商品の原材料表示を確認しました",
  });
  if ((await labelConfirm.count()) > 0) {
    await labelConfirm.first().click();
  }

  // 全体再生成（recovery ではないが別案経路）
  await setMockScenario(page, "alternate-menu");
  if (menuId === undefined) {
    throw new Error("menuId required for household regeneration");
  }
  await requestWholeRegeneration(page, menuId, "simpler");
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 60_000,
  });

  // 履歴グループ
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "作った献立" })).toBeVisible({
    timeout: 15_000,
  });

  // 採用
  await page.goto(`/menus/${menuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({
    timeout: 30_000,
  });
  const accept = page.getByRole("button", { name: "これに決めた" });
  await expect(accept).toBeEnabled({ timeout: 30_000 });
  await accept.click();

  // 買い物リスト作成（結果画面は確認パネル →「作成する」で /shopping へ）
  const shop = page.getByRole("button", { name: "買い物リストを作る" });
  await expect(shop).toBeEnabled({ timeout: 60_000 });
  await shop.click();
  const newChoice = page.getByRole("radio", { name: "新しいリストにする" });
  if (await newChoice.isVisible().catch(() => false)) {
    await newChoice.check();
  }
  await page.getByRole("button", { name: "作成する" }).click();
  await expect(page).toHaveURL(/\/shopping$/u, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible({
    timeout: 30_000,
  });

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

/**
 * idea ジャーニー。seed ではなく wizard から idea を生成し、
 * 家族安全 UI / 買い物 API が無いことと mode 維持再生成を証明する。
 */
test("idea journey: no family safety, no shopping, mode-preserving regen", async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });

  const shoppingRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/shopping-lists")) {
      shoppingRequests.push(path);
    }
  });

  await page.goto("/welcome");
  await page.getByRole("button", { name: "献立アイデアを考える" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/planner");

  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
  await page.getByRole("radio", { name: "朝食" }).check();
  await clickWizardNext(page);
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await clickWizardNext(page);
  await page.getByRole("radio", { name: "和食" }).check();
  await clickWizardNext(page);
  await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
  await page.getByRole("button", { name: "2人" }).click();
  await clickWizardNext(page);

  await expect(page.getByText("家族の年齢・アレルギーは確認されません")).toBeVisible();
  await setMockScenario(page, "idea-servings-2");
  const generate = page.getByRole("button", { name: "献立を作る" });
  if (await generate.isDisabled().catch(() => false)) {
    await page.getByRole("button", { name: "AI情報の説明を見る" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    // reload 前に同意保存と planner 復帰を待つ（即 reload すると privacy に残る）
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await page.reload();
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toHaveCount(0);

  const menuId = /\/menus\/([0-9a-f-]{36})/iu.exec(page.url())?.[1];
  expect(menuId).toBeTruthy();

  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
  await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await setMockScenario(page, "idea-alternate-menu-1");
  if (menuId === undefined) {
    throw new Error("menuId required for idea regeneration");
  }
  await requestWholeRegeneration(page, menuId, "simpler", { targetMode: "idea" });
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 60_000 });

  const fav = page.getByRole("button", { name: /お気に入り/u });
  await expect(fav).toBeVisible();
  await fav.click();

  expect(shoppingRequests).toEqual([]);
  const shoppingKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("kondate:shopping:")),
  );
  expect(shoppingKeys).toEqual([]);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
