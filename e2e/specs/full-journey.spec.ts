import { clickWizardNext, expect, setMockScenario, test } from "../fixtures/acceptance";
import {
  expectIdeaResultSurface,
  openFirstMemberEditor,
  openWizardFromHome,
  requestWholeRegeneration,
  selectHouseholdAudienceWithMember,
  skipOptionalPlannerSteps,
} from "../fixtures/history";
import { chooseCreateListModeNew } from "../fixtures/shopping";
import { z } from "zod";

// Spec §7.4: 生成が密集するジャーニー。global 行ロック residual と mock scenario を安定させるため serial。
test.describe.configure({ mode: "serial" });

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
test(
  "household journey: welcome through shopping create and alternate reconcile",
  {
    tag: ["@smoke"],
  },
  async ({ completedOnboardingPage: page }) => {
    // E2E5: mobile project のみ 320 を固定。desktop-chromium は Desktop Chrome 幅のまま
    // 走らせ、layout 退行を dual-project の vacuous green にしない。
    if (test.info().project.name === "mobile-chromium") {
      await page.setViewportSize({ width: 320, height: 720 });
    }

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
    // Phase 4: 素の /planner はホーム → 主 CTA でウィザードへ。
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
    // C-I4: メンバー明示選択 + 成功 autosave 完了を待ってから次へ（未保存 draft で生成しない）
    await selectHouseholdAudienceWithMember(page);
    // 二度目は既選択の early-return 境界。UI checked に加え server draft member_ids 非空も helper 内で固定（E2E7）。
    await selectHouseholdAudienceWithMember(page);
    await expect(page.getByRole("checkbox", { name: /家族1/u })).toBeChecked();
    await clickWizardNext(page);

    // 任意4ページはカード選択では進まない。選んでから「次へ」で送る。
    // heading 可視直後の「次へ」は 350ms 活性化ガードに食われるので待つ。
    // ここだけスキップせず、選択が保持されたまま送られることも同時に主張する。
    await expect(page.getByRole("heading", { name: "5. 調理時間" })).toBeVisible();
    await page.locator("label.wizard-option").filter({ hasText: "15分以内" }).click();
    await page.waitForTimeout(350);
    await clickWizardNext(page);

    await expect(page.getByRole("heading", { name: "6. 予算" })).toBeVisible();
    await page.locator("label.wizard-option").filter({ hasText: "節約優先" }).click();
    await page.waitForTimeout(350);
    await clickWizardNext(page);

    await expect(page.getByRole("heading", { name: "7. 材料の使い方" })).toBeVisible();
    await page.locator("label.wizard-option").filter({ hasText: "多め" }).click();
    await page.waitForTimeout(350);
    await clickWizardNext(page);

    await expect(page.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeVisible();
    // P-T6-WAIT: twist 保存の waitForResponse は「ひねりたい」click の直前に置く。
    const noveltySaved = page.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft")) {
        return false;
      }
      const postData = response.request().postData();
      return postData !== null && postData.includes('"p_novelty_preference":"twist"');
    });
    await page
      .locator("label.wizard-option")
      .filter({ hasText: "いつもと違う主菜に（調理法や組み合わせを変える）" })
      .click();
    await noveltySaved;
    await page.waitForTimeout(350);
    await clickWizardNext(page);

    await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible();
    // privacy は fixture 済み。CTA が出ていたら契約退行なので落とし、黙ってスキップしない。
    await expect(page.getByRole("button", { name: "AI情報の説明を見る" })).toHaveCount(0);
    // 共有 AI 枠は suite/project 境界の shell のみ（並列 worker 下で test から truncate 禁止）
    const generate = page.getByRole("button", { name: "献立を作る" });
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();
    await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(/この献立の対象家族の設定で確認しました/u)).toBeVisible({
      timeout: 30_000,
    });
    // success fixture 主菜（shallow 回避: 見出し/URL だけでない中身）
    await expect(page.getByRole("heading", { name: "鶏肉と白菜のやわらか煮" })).toBeVisible({
      timeout: 15_000,
    });

    const sourceMenuId = menuUuid().parse(
      /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1],
    );

    // 料理タブ — 段取り側 tablist（「献立の段取りと材料」）と混同しない
    const dishTablist = page.getByRole("tablist", { name: "料理" });
    const dishTab = dishTablist.getByRole("tab").first();
    await expect(dishTab).toBeVisible();
    await dishTab.click();

    // mock success + 小麦メンバーでは labelConfirmation が必須。無いと契約退行を見逃す。
    const labelConfirm = page.getByRole("button", {
      name: "本人が商品の原材料表示を確認しました",
    });
    await expect(labelConfirm).toBeVisible({ timeout: 30_000 });
    await labelConfirm.click();

    // 先に source から買い物リストを作成し、後段の新案 reconcile の土台にする。
    // soft recheck / mount recheck 中は採用・買い物 CTA が disabled。idle 後に settle する。
    await expect(page.getByText("この献立の対象家族の設定を再確認しています")).toHaveCount(0, {
      timeout: 90_000,
    });
    await expect(page.getByText("この献立の対象家族の設定で確認しています")).toHaveCount(0, {
      timeout: 90_000,
    });
    const acceptSource = page.getByRole("button", { name: "この献立にする" });
    const shopCreate = page.getByRole("button", { name: "材料の買い物リストを作る" });
    const createSheetHeading = page.getByRole("heading", { name: "買い物リストを作る" });
    // versions+gate settle: 採用か買い物のどちらかが有効になるまで待つ
    await expect
      .poll(
        async () => {
          const shopOk = await shopCreate.isEnabled().catch(() => false);
          const acceptOk = await acceptSource.isEnabled().catch(() => false);
          const sheetOpen = await createSheetHeading.isVisible().catch(() => false);
          return shopOk || acceptOk || sheetOpen;
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    // sticky intent 等で create シートが auto-open していると採用 CTA が dialog 下で click 不能。
    // 採用を先に確定するため、開いていれば一度閉じる（キャンセルはシート abandon のみ）。
    if (await createSheetHeading.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "キャンセル" }).click();
      await expect(createSheetHeading).toHaveCount(0, { timeout: 15_000 });
    }
    // E2E1: soft skip 禁止。CTA が見える経路では必須で採用する。
    // versions 未確定・一瞬 disabled を isVisible().catch で吸うと採用 POST 0 のまま create まで green。
    // 単一案 (confirmedSingle) でも補助に「この献立にする」が出る。既 isSelected なら count 0。
    if ((await acceptSource.count()) > 0) {
      // soft recheck 中の no-op click を避ける: enabled かつ再確認文言が消えてから採用
      await expect(page.getByText("この献立の対象家族の設定を再確認しています")).toHaveCount(0, {
        timeout: 90_000,
      });
      await expect(acceptSource).toBeEnabled({ timeout: 30_000 });
      await acceptSource.click();
      // 採用後は CTA が消える（accepted / 買い物 primary 昇格）。soft 競合で残る場合は再試行。
      try {
        await expect(acceptSource).toHaveCount(0, { timeout: 15_000 });
      } catch {
        await expect(page.getByText("この献立の対象家族の設定を再確認しています")).toHaveCount(0, {
          timeout: 90_000,
        });
        if (await createSheetHeading.isVisible().catch(() => false)) {
          await page.getByRole("button", { name: "キャンセル" }).click();
          await expect(createSheetHeading).toHaveCount(0, { timeout: 15_000 });
        }
        if ((await acceptSource.count()) > 0) {
          await expect(acceptSource).toBeEnabled({ timeout: 30_000 });
          await acceptSource.click();
        }
        await expect(acceptSource).toHaveCount(0, { timeout: 30_000 });
      }
    }
    await expect(shopCreate).toBeEnabled({ timeout: 90_000 });
    // 作成シートは click で <dialog> が opener を覆う。開閉は見出しで固定する。
    if (!(await createSheetHeading.isVisible().catch(() => false))) {
      await shopCreate.click();
    }
    await expect(createSheetHeading).toBeVisible({ timeout: 60_000 });
    // E2E8: mode=new を helper 正本で確定（soft skip で append 既定のまま進まない）
    await chooseCreateListModeNew(page);
    // list 初回 fetch 完了後に CTA が有効になる
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
    await expect(page.getByText("2案", { exact: true })).toBeVisible({ timeout: 15_000 });

    // E2E3: 新案を採用し、既存リストとの差分 reconcile まで通す（source には戻らない）
    await page.goto(`/menus/${alternateMenuId}`);
    await expect(page.getByText(/この献立の対象家族の設定で確認しました/u)).toBeVisible({
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
    // E2E1: 空 diff / no-op apply の偽 green を潰す。alternate-menu は success と材料が
    // 差し替わる（鶏むね肉・きゅうり 等）ため、追加 legend が 1 件以上かつ固有名が載る。
    await expect(page.getByRole("group", { name: /^追加 [1-9]\d*件$/u })).toBeVisible({
      timeout: 15_000,
    });
    // alternate fixture 固有の追加材料（success は「にんじん」側菜）。
    // 使用先の料理名「きゅうりともやしの浅漬け」にも部分一致するため displayName の strong に限定する。
    const addGroup = page.getByRole("group", { name: /^追加 [1-9]\d*件$/u });
    await expect(addGroup.locator("strong").filter({ hasText: "きゅうり" })).toBeVisible();
    await expect(addGroup.locator("strong").filter({ hasText: "鶏むね肉" })).toBeVisible();
    await page.getByRole("button", { name: "選んだ変更を反映" }).click();
    await expect(page).toHaveURL(/\/shopping$/u, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible({
      timeout: 30_000,
    });
    // 反映後リスト上に alternate 由来 item が載ること（任意 checkbox だけだと no-op でも通る）
    await expect(page.getByRole("checkbox", { name: "きゅうりを購入済みにする" })).toBeEnabled({
      timeout: 60_000,
    });
    await expect(page.getByRole("checkbox", { name: "鶏むね肉を購入済みにする" })).toBeEnabled({
      timeout: 30_000,
    });

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  },
);

/**
 * idea ジャーニー。seed ではなく wizard から idea を生成し、
 * 家族安全 UI / 買い物 API が無いことと mode 維持再生成を証明する。
 */
test(
  "idea journey: no family safety, no shopping, mode-preserving regen",
  {
    tag: ["@smoke"],
  },
  async ({ authenticatedPage: page }) => {
    // E2E5: mobile のみ 320 固定。desktop project では Desktop Chrome 幅を保つ。
    if (test.info().project.name === "mobile-chromium") {
      await page.setViewportSize({ width: 320, height: 720 });
    }

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
    // Phase 4: ホーム主 CTA からウィザードへ
    await page.getByRole("button", { name: "今日の献立をつくる" }).click();

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
    await skipOptionalPlannerSteps(page);

    await expect(page.getByText("家族の年齢・アレルギーは確認されません")).toBeVisible();
    await setMockScenario(page, "idea-servings-1");
    const generate = page.getByRole("button", { name: "献立を作る" });
    const privacyCta = page.getByRole("button", { name: "AI情報の説明を見る" });
    // idea は privacy 未了が正常経路。openPrivacyNotice は flushDraft 後に resume=review で戻る。
    // 本番ユーザーはフル reload しないため、SPA 復帰だけで review に留まることを主張する。
    await expect(privacyCta).toBeVisible();
    await privacyCta.click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    // 共有チェックは任意・既定 on。必須同意だけ確認して進み、生成導線（review resume）が死なないこと。
    const shareCheckbox = page.getByRole("checkbox", { name: "匿名で緊急候補に役立ててよい" });
    await expect(shareCheckbox).toBeVisible();
    await expect(shareCheckbox).toBeChecked();
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === "/planner" && url.searchParams.get("resume") === "review",
    );
    // reload なしで確認 step を維持（draft cache 巻き戻りの製品退行を検出する）
    await expect(page.getByRole("heading", { name: "9. 確認" })).toBeVisible({
      timeout: 15_000,
    });
    // 共有 AI 枠は suite/project 境界の shell のみ（並列 worker 下で test から truncate 禁止）
    await expect(generate).toBeEnabled({ timeout: 15_000 });
    await generate.click();
    await expect(page).toHaveURL(/\/menus\/[0-9a-f-]{36}/iu, { timeout: 90_000 });
    await expectIdeaResultSurface(page, { timeout: 30_000 });
    await expect(page.getByText(/この献立の対象家族の設定で確認しました/u)).toHaveCount(0);
    // idea success fixture 主菜
    await expect(page.getByRole("heading", { name: "鶏肉と白菜のやわらか煮" })).toBeVisible({
      timeout: 15_000,
    });

    const menuId = menuUuid().parse(
      /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1],
    );

    await page.getByRole("button", { name: "この案を元に別の献立を作り直す" }).click();
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

    // E2E3: click だけでなく状態遷移（外す CTA へ）まで固定する
    const fav = page.getByRole("button", { name: "お気に入りに追加" });
    await expect(fav).toBeVisible();
    await fav.click();
    await expect(page.getByRole("button", { name: "お気に入りを外す" })).toBeVisible({
      timeout: 15_000,
    });

    // E2E2: network/storage に加え UI 上も買い物 CTA が無いことを固定する
    await expect(page.getByRole("button", { name: "材料の買い物リストを作る" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "買い物リストの差分を見る" })).toHaveCount(0);

    expect(shoppingRequests).toEqual([]);
    // SHOP3: pending create/reconcile は local 正本 + session mirror。
    // idea 経路ではどちらにも kondate:shopping: が残らないこと。
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
  },
);
