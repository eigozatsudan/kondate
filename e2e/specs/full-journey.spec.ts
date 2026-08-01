import { clickWizardNext, expect, setMockScenario, test } from "../fixtures/acceptance";
import {
  expectIdeaResultSurface,
  openFirstMemberEditor,
  requestWholeRegeneration,
  selectHouseholdAudienceWithMember,
} from "../fixtures/history";
import { z } from "zod";

test.setTimeout(360_000);

const menuUuid = () => z.uuid();

/**
 * household 受け入れジャーニー。seed helper で献立生成を短絡しない。
 * welcome 相当（complete 後は /planner）→ 設定 → planner wizard → generate →
 * label/tab → shopping create → whole regen → 新案で reconcile まで実操作で通す。
 *
 * 注: completedOnboardingPage は fixture 内で privacy 同意済みのため、
 * 本テストでは privacy CTA 分岐を踏まない（idea journey / mobile-a11y が privacy 往復を証明）。
 */
test("household journey: welcome through shopping create and alternate reconcile", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });

  // 小麦ラベル確認が必要な mock success 用メンバーを整える
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  // editorOpen 既定 false のため、呼び名入力前に編集フォームを開く
  await openFirstMemberEditor(page);
  await page.getByRole("textbox", { name: "呼び名" }).fill("家族1");
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
  // C-I4: メンバー明示選択 + 成功 autosave 完了を待ってから次へ（未保存 draft で生成しない）
  await selectHouseholdAudienceWithMember(page);
  // 二度目は既選択の early-return 境界。チェック維持を固定する（POST 0 回でも UI は選択済み）。
  await selectHouseholdAudienceWithMember(page);
  await expect(page.getByRole("checkbox", { name: /家族1/u })).toBeChecked();
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  // privacy は fixture 済み。CTA が出ていたら契約退行なので落とし、黙ってスキップしない。
  await expect(page.getByRole("button", { name: "AI情報の説明を見る" })).toHaveCount(0);
  const generate = page.getByRole("button", { name: "献立を作る" });
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({ timeout: 30_000 });
  // success fixture 主菜（shallow 回避: 見出し/URL だけでない中身）
  await expect(page.getByRole("heading", { name: "鶏肉と白菜のやわらか煮" })).toBeVisible({
    timeout: 15_000,
  });

  const sourceMenuId = menuUuid().parse(
    /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1],
  );

  // 料理タブ
  const dishTab = page.getByRole("tab").first();
  await expect(dishTab).toBeVisible();
  await dishTab.click();

  // mock success + 小麦メンバーでは labelConfirmation が必須。無いと契約退行を見逃す。
  const labelConfirm = page.getByRole("button", {
    name: "本人が商品の原材料表示を確認しました",
  });
  await expect(labelConfirm).toBeVisible({ timeout: 30_000 });
  await labelConfirm.click();

  // 先に source から買い物リストを作成し、後段の新案 reconcile の土台にする
  const acceptSource = page.getByRole("button", { name: "この献立にする" });
  await expect(acceptSource).toBeEnabled({ timeout: 30_000 });
  await acceptSource.click();
  const shopCreate = page.getByRole("button", { name: "材料の買い物リストを作る" });
  await expect(shopCreate).toBeEnabled({ timeout: 60_000 });
  await shopCreate.click();
  const newChoice = page.getByRole("radio", { name: "新しいリストにする" });
  if (await newChoice.isVisible().catch(() => false)) {
    await newChoice.check();
  }
  // dialog が開くまで待つ（list 初回 fetch 完了後に CTA が有効になる）
  await expect(page.getByRole("heading", { name: "買い物リストを作る" })).toBeVisible({
    timeout: 60_000,
  });
  const createConfirm = page.getByRole("button", { name: "作成する" });
  await expect(createConfirm).toBeEnabled({ timeout: 60_000 });
  await createConfirm.click();
  await expect(page).toHaveURL(/\/shopping$/u, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible({
    timeout: 30_000,
  });
  // リストに項目があること（heading だけだと空リストでも通る）
  await expect(page.getByRole("checkbox", { name: /を購入済みにする/u }).first()).toBeEnabled({
    timeout: 60_000,
  });

  // 全体再生成（source から別案）。alternate-menu fixture は主菜名が変わる。
  await setMockScenario(page, "alternate-menu");
  await requestWholeRegeneration(page, sourceMenuId, "simpler");
  await expect(page).toHaveURL(new RegExp(`/menus/(?!${sourceMenuId})[0-9a-f-]{36}`, "iu"), {
    timeout: 90_000,
  });
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 60_000,
  });
  // E2E7: scenario 中身を固定（times:1 が吸われ default success のまま進む偽 green を防ぐ）
  await expect(page.getByRole("heading", { name: "鶏肉のさっぱり煮" })).toBeVisible({
    timeout: 30_000,
  });

  const alternateMenuId = menuUuid().parse(
    /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1],
  );
  expect(alternateMenuId).not.toBe(sourceMenuId);

  // 履歴グループ: 全体再生成後は同一 derivation に 2 案あることまで固定する
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "作った献立" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("2案")).toBeVisible({ timeout: 15_000 });

  // E2E3: 新案を採用し、既存リストとの差分 reconcile まで通す（source には戻らない）
  await page.goto(`/menus/${alternateMenuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "鶏肉のさっぱり煮" })).toBeVisible({
    timeout: 15_000,
  });
  const acceptAlternate = page.getByRole("button", { name: "この献立にする" });
  await expect(acceptAlternate).toBeEnabled({ timeout: 30_000 });
  await acceptAlternate.click();

  const reconcileCta = page.getByRole("button", { name: "買い物リストの差分を見る" });
  await expect(reconcileCta).toBeEnabled({ timeout: 60_000 });
  await reconcileCta.click();
  // protected 文言は購入済み/手動変更があるときだけ出る。本ジャーニーは未保護のため常時見出しで開通を固定する
  // （保護コピー自体は shopping-list.spec の protected rows で検証）。
  await expect(page.getByRole("heading", { name: "献立変更の差分" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "選んだ変更を反映" }).click();
  await expect(page).toHaveURL(/\/shopping$/u, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("checkbox", { name: /を購入済みにする/u }).first()).toBeEnabled({
    timeout: 60_000,
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
  // idea-alternate-menu-1 は servings=1 固定のため初回も 1 人で揃える
  await page.getByRole("button", { name: "1人" }).click();
  await clickWizardNext(page);

  await expect(page.getByText("家族の年齢・アレルギーは確認されません")).toBeVisible();
  await setMockScenario(page, "idea-servings-1");
  const generate = page.getByRole("button", { name: "献立を作る" });
  const privacyCta = page.getByRole("button", { name: "AI情報の説明を見る" });
  // idea は privacy 未了が正常経路。openPrivacyNotice は flushDraft 後に resume=review で戻る。
  // 本番ユーザーはフル reload しないため、SPA 復帰だけで review に留まることを主張する。
  await expect(privacyCta).toBeVisible();
  await privacyCta.click();
  await expect(page).toHaveURL((url) => url.pathname === "/privacy");
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/planner" && url.searchParams.get("resume") === "review",
  );
  // reload なしで確認 step を維持（draft cache 巻き戻りの製品退行を検出する）
  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
  await expectIdeaResultSurface(page, { timeout: 30_000 });
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toHaveCount(0);
  // idea success fixture 主菜
  await expect(page.getByRole("heading", { name: "鶏肉と白菜のやわらか煮" })).toBeVisible({
    timeout: 15_000,
  });

  const menuId = menuUuid().parse(
    /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1],
  );

  await page.getByRole("button", { name: "別の献立を作り直す" }).click();
  await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  await page.getByRole("button", { name: "やめる" }).click();

  await setMockScenario(page, "idea-alternate-menu-1");
  await requestWholeRegeneration(page, menuId, "simpler", { targetMode: "idea" });
  await expect(page).toHaveURL(new RegExp(`/menus/(?!${menuId})[0-9a-f-]{36}`, "iu"), {
    timeout: 90_000,
  });
  await expectIdeaResultSurface(page, { timeout: 60_000 });
  // alternate fixture 中身（吸込みで default success のまま進むのを防ぐ）
  await expect(page.getByRole("heading", { name: "鶏肉のさっぱり煮" })).toBeVisible({
    timeout: 30_000,
  });

  const fav = page.getByRole("button", { name: /お気に入り/u });
  await expect(fav).toBeVisible();
  await fav.click();

  expect(shoppingRequests).toEqual([]);
  // 製品の shopping intent / pending create は sessionStorage（localStorage では vacuous）
  const shoppingSessionKeys = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((key) => key.startsWith("kondate:shopping:")),
  );
  expect(shoppingSessionKeys).toEqual([]);
  const shoppingLocalKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("kondate:shopping:")),
  );
  expect(shoppingLocalKeys).toEqual([]);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
