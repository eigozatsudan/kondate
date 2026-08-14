import { z } from "zod";
import {
  createShoppingListRequestSchema,
  reconcileShoppingListRequestSchema,
} from "../../shared/contracts/shopping";
import {
  chooseCreateListModeNew,
  createListFromMenu,
  deferMatchingRequest,
  expect,
  markFirstMemberAllergyUnconfirmed,
  regenerateWholeMenu,
  test,
} from "../fixtures/shopping";
import { openFirstMemberEditor } from "../fixtures/history";
import type { Route } from "@playwright/test";

// Spec §7.4: race 系は共有 app 経路・household 変異・route abort を前提とし並列と相性が悪い。
// ファイル全体を serial にし、workers≥2 でも同一 file 内は 1 worker 直列にする。
test.describe.configure({ mode: "serial" });

// 献立生成を伴うため既定の30秒では足りない（既存の履歴系specと同じ扱い）。
test.setTimeout(180_000);

/** safety 変更後 create/reconcile が契約どおり返す code（5xx や別 4xx の false green を閉じる） */
const SAFETY_REJECT_CODES = new Set(["current_safety_revalidation_required"]);

type CapturedHttpReject = { status: number; code: string | undefined };

/**
 * route.fetch の status と error.code を記録し、同一 body で fulfill する。
 * json() 消費で body が消えないよう text 経由で往復する（E2E12）。
 */
async function captureRejectAndFulfill(route: Route, into: CapturedHttpReject[]): Promise<void> {
  const response = await route.fetch();
  const bodyText = await response.text();
  const status = response.status();
  let code: string | undefined;
  try {
    const parsed = z
      .looseObject({
        error: z.object({ code: z.string() }).partial().optional(),
      })
      .safeParse(JSON.parse(bodyText) as unknown);
    code = parsed.success ? parsed.data.error?.code : undefined;
  } catch {
    code = undefined;
  }
  into.push({ status, code });
  await route.fulfill({
    status,
    headers: response.headers(),
    body: bodyText,
  });
}

/** 4xx かつ契約 code。5xx や code 欠落は不合格。 */
function expectSafetyContractReject(results: CapturedHttpReject[], label: string): void {
  expect(results.length, `${label}: expected at least one response`).toBeGreaterThanOrEqual(1);
  for (const result of results) {
    expect(
      result.status,
      `${label}: must not succeed (got ${String(result.status)} code=${String(result.code)})`,
    ).toBeGreaterThanOrEqual(400);
    expect(
      result.status,
      `${label}: 5xx is not a contractual safety reject (got ${String(result.status)})`,
    ).toBeLessThan(500);
    expect(
      SAFETY_REJECT_CODES.has(result.code ?? ""),
      `${label}: expected code in {${[...SAFETY_REJECT_CODES].join(", ")}}, got status=${String(result.status)} code=${String(result.code)}`,
    ).toBe(true);
  }
}

test(
  "reuses one idempotency key after the first response is lost",
  {
    tag: ["@smoke"],
  },
  async ({ authenticatedPage: page, shoppingMenuId }) => {
    let calls = 0;
    const bodies: string[] = [];
    await page.route("**/api/shopping-lists/from-menu", async (route) => {
      bodies.push(route.request().postData() ?? "");
      calls += 1;
      if (calls === 1) {
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await createListFromMenu(page, shoppingMenuId);
    expect(calls).toBe(2);
    const commands = bodies.map((body) => createShoppingListRequestSchema.parse(JSON.parse(body)));
    expect(new Set(commands.map((command) => command.idempotencyKey)).size).toBe(1);
    await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible();
  },
);

test("rejects creation after current household safety changes", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  // 設計書は「作成ボタン → 作成する → エラー文言」の経路を想定しているが、
  // Task 5 UI は安全ゲートで作成ボタン自体を disabled にする（fail closed）。
  // history-safety-change.spec と同じ観測点に揃える。アサーションの主張
  // （安全条件変更後は作成できない）は変えない。
  await markFirstMemberAllergyUnconfirmed(page);
  await page.goto(`/menus/${shoppingMenuId}`);
  await expect(page.getByRole("alert")).toContainText(/現在の(家族設定|安全条件)/u, {
    timeout: 30_000,
  });
  // HR2: 安全ゲート閉鎖時は作成 CTA を非表示（disabled で残さない）
  await expect(page.getByRole("button", { name: "材料の買い物リストを作る" })).toHaveCount(0);
});

test("disables shopping actions immediately after member or allergy mutation", async ({
  authenticatedPage: shoppingPage,
  shoppingMenuId,
}) => {
  await createListFromMenu(shoppingPage, shoppingMenuId);
  const settingsPage = await shoppingPage.context().newPage();
  await settingsPage.goto("/settings");
  // editorOpen 既定 false のため、呼び名入力前に編集フォームを開く
  await openFirstMemberEditor(settingsPage);
  const reload = await deferMatchingRequest(shoppingPage, "**/rest/v1/shopping_lists*");
  const sourceRevalidation = await deferMatchingRequest(
    shoppingPage,
    "**/api/shopping-lists/*/revalidate",
  );
  // 設計書の「表示名 / 家族設定を保存」は本リポジトリの設定UIに存在しない。
  // 同じ household_members 更新を行う実コントロール（呼び名 + 設定完了）へ読み替える。
  await settingsPage.getByRole("textbox", { name: "呼び名" }).fill("更新後の家族");
  await settingsPage.getByRole("button", { name: "この家族の設定を完了" }).click();
  await expect(
    shoppingPage.getByRole("checkbox", { name: /購入済みにする/u }).first(),
  ).toBeDisabled({ timeout: 30_000 });
  await expect(
    shoppingPage.getByRole("button", { name: "数量・単位・売り場を編集" }).first(),
  ).toBeDisabled();
  await reload.release();
  await expect(
    shoppingPage.getByRole("checkbox", { name: /購入済みにする/u }).first(),
  ).toBeDisabled();
  await sourceRevalidation.release();
  await expect(shoppingPage.getByRole("checkbox", { name: /購入済みにする/u }).first()).toBeEnabled(
    { timeout: 30_000 },
  );
  // 設定完了で editor が閉じるため、アレルギー操作前に一覧から再オープンする
  // （settings.spec と同じ editorOpen 既定 false 契約）。
  await openFirstMemberEditor(settingsPage);
  // 同じく「アレルギーを編集 / アレルギーを保存」は存在しない。
  // アレルギー編集を開く操作＝「アレルギーの確認」を登録ありにする、
  // member_allergies を書き込む操作＝「くるみを追加」に読み替える。
  await settingsPage.getByLabel("アレルギーの確認").selectOption("registered");
  const allergyReload = await deferMatchingRequest(shoppingPage, "**/rest/v1/shopping_lists*");
  const allergyRevalidation = await deferMatchingRequest(
    shoppingPage,
    "**/api/shopping-lists/*/revalidate",
  );
  await settingsPage.getByRole("button", { name: "くるみを追加" }).click();
  await expect(
    shoppingPage.getByRole("checkbox", { name: /購入済みにする/u }).first(),
  ).toBeDisabled({ timeout: 30_000 });
  await allergyReload.release();
  await expect(
    shoppingPage.getByRole("checkbox", { name: /購入済みにする/u }).first(),
  ).toBeDisabled();
  await allergyRevalidation.release();
  // 再検証完了後も fail-closed のまま（くるみ追加後は操作を解放しない）。
  await expect(
    shoppingPage.getByRole("checkbox", { name: /購入済みにする/u }).first(),
  ).toBeDisabled();
});

/**
 * E2E5: サーバ側だけで household safety を崩したあと、hard 安全 refresh 入口
 * （製品では Realtime postgres_changes / same-tab CustomEvent / storage revision /
 * focus・online が同じ refresh を叩く）が閉じること。
 *
 * REST PATCH だけでは同タブに CustomEvent / storage が飛ばない。Realtime 配信は
 * 環境依存で 90s flake の元になるため、本テストは Realtime 配線そのものではなく
 * 「サーバ mutation 後に hard refresh が走ったときの fail-closed」を決定論的に固定する。
 * hard 信号は製品と同一の CustomEvent を page.evaluate で注入する。
 */
test("fails closed after server-side household safety change when hard safety refresh fires", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  await page.goto("/shopping");
  // gate ready まで待ってから mutation（checking 中の誤観測を避ける）
  await expect(page.getByRole("checkbox", { name: /購入済みにする/u }).first()).toBeEnabled({
    timeout: 60_000,
  });
  const revalidation = await deferMatchingRequest(page, "**/api/shopping-lists/*/revalidate");
  await markFirstMemberAllergyUnconfirmed(page);
  // hard refresh 入口（useShoppingSafetyGate の householdSafetyChangedEvent と同名）
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("kondate:household-safety-changed"));
  });
  // hard は即 checking → disabled。revalidate 応答を待たない（soft poll 60s とは別経路）
  await expect(page.getByRole("checkbox", { name: /購入済みにする/u }).first()).toBeDisabled({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "数量・単位・売り場を編集" }).first(),
  ).toBeDisabled();
  await revalidation.release();
  await expect(page.getByText(/現在の家族設定/u)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: /購入済みにする/u }).first()).toBeDisabled();
});

test("replays reconciliation after the committed response is lost", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  const nextMenuId = await regenerateWholeMenu(page, shoppingMenuId);
  await page.goto(`/menus/${nextMenuId}`);
  await expect(page.getByRole("button", { name: "買い物リストの差分を見る" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "買い物リストの差分を見る" }).click();
  const bodies: string[] = [];
  let first = true;
  await page.route("**/api/shopping-lists/*/reconcile", async (route) => {
    bodies.push(route.request().postData() ?? "");
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "選んだ変更を反映" }).click();
  await expect(page).toHaveURL(/\/shopping$/u, { timeout: 60_000 });
  expect(bodies).toHaveLength(2);
  const commands = bodies.map((body) => reconcileShoppingListRequestSchema.parse(JSON.parse(body)));
  expect(new Set(commands.map((command) => command.idempotencyKey)).size).toBe(1);
});

/**
 * Cross-unit: shopping create の sessionStorage pending が残った状態で
 * household safety を崩し、その後に届いた create がリストを立てないことを固定する。
 * 単機能の create 冪等（fetch 後 abort）や settings+list ゲートとは別経路。
 *
 * 1通目を safety 変更までサーバに渡さず保留し、pending envelope だけ先に残す。
 * 解放後の POST は current_safety 再検証で拒否され、使用中リストはできない。
 */
test("pending create envelope does not create a list after household safety changes", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  let createPosts = 0;
  const createRejects: CapturedHttpReject[] = [];
  let releaseCreates: () => void = () => undefined;
  const createsReleased = new Promise<void>((resolve) => {
    releaseCreates = resolve;
  });
  let released = false;

  await page.route("**/api/shopping-lists/from-menu", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createPosts += 1;
    if (!released) await createsReleased;
    await captureRejectAndFulfill(route, createRejects);
  });

  await page.goto(`/menus/${shoppingMenuId}`);
  const createButton = page.getByRole("button", { name: "材料の買い物リストを作る" });
  await expect(createButton).toBeEnabled({ timeout: 60_000 });
  await createButton.click();
  // E2E8: mode=new soft skip 禁止（active 残存時の append 既定で pending create 契約が崩れる）
  await chooseCreateListModeNew(page);
  await page.getByRole("button", { name: "作成する" }).click();

  // pending create envelope が dual-write されること（POST 保留中）。
  // SHOP3: localStorage が multi-tab 正本、session は同タブ mirror（session だけ見ると
  // local 欠落退行が緑のまま残る — E2E1）。
  await expect
    .poll(
      async () =>
        page.evaluate((menuId) => {
          const match = (storage: Storage) =>
            Object.keys(storage).some(
              (key) => key.startsWith("kondate:shopping:create:") && key.includes(menuId),
            );
          return match(sessionStorage) && match(localStorage);
        }, shoppingMenuId),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(createPosts).toBeGreaterThanOrEqual(1);

  // E2E1: 同一 origin の peer タブは session 空でも localStorage sticky を共有する。
  // page.close + create resume の完全経路は重いため本 pass では sticky 共有まで固定する。
  // about:blank では localStorage が SecurityError になるため app origin を開く。
  const peer = await page.context().newPage();
  try {
    await peer.goto("/");
    const peerSticky = await peer.evaluate((menuId) => {
      const match = (storage: Storage) =>
        Object.keys(storage).filter(
          (key) => key.startsWith("kondate:shopping:create:") && key.includes(menuId),
        );
      return { local: match(localStorage), session: match(sessionStorage) };
    }, shoppingMenuId);
    expect(
      peerSticky.local.length,
      "peer tab must see create sticky in localStorage",
    ).toBeGreaterThan(0);
    // 新 page の sessionStorage は空。local 正本だけが multi-tab を支える。
    expect(peerSticky.session).toEqual([]);
  } finally {
    await peer.close();
  }

  // 横断: safety を崩してから保留中の create を解放する。
  // REST だけでは同タブ hard が飛ばないため、製品 hard 入口と同名 CustomEvent を注入
  // （Realtime 欠落時の CTA disabled / 家族 alert 未達 flake を避ける）。
  await markFirstMemberAllergyUnconfirmed(page);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("kondate:household-safety-changed"));
  });
  released = true;
  releaseCreates();

  // 解放後の create は 4xx + current_safety_revalidation_required（5xx は不合格）
  await expect.poll(() => createRejects.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expectSafetyContractReject(createRejects, "create after safety change");

  // メニュー結果は安全条件変更で fail closed。HR2: 作成 CTA は非表示。
  // shopping 側の別 alert（リスト状態）と strict 衝突しないよう文言で絞る。
  await expect(
    page.getByRole("alert").filter({ hasText: /現在の(家族設定|安全条件)/u }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "材料の買い物リストを作る" })).toHaveCount(0);

  // E2E6 / SHOP1: current_safety_revalidation_required では sticky を残し
  // （適用済み+応答ロスト後の新 key dual-create を防ぐ）、resume-suppress で
  // auto-resume の 409 ループを止める。ユーザー向け状態変化メッセージは出す。
  // E2E1: local+session 両方に残ること（session のみ残存の退行を落とす）。
  await expect
    .poll(
      async () =>
        page.evaluate((menuId) => {
          const match = (storage: Storage) =>
            Object.keys(storage).some(
              (key) => key.startsWith("kondate:shopping:create:") && key.includes(menuId),
            );
          return match(sessionStorage) && match(localStorage);
        }, shoppingMenuId),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(
    page.getByText("買い物リストの状態が変わりました。もう一度確認してください"),
  ).toBeVisible({ timeout: 15_000 });

  // /shopping に使用中リストの操作可能 checkbox が無いこと
  await page.goto("/shopping");
  await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("checkbox", { name: /を購入済みにする/u })).toHaveCount(0);
});

/**
 * E2E7: reconcile sessionStorage pending × household safety 横断。
 * create pending×safety と同型で、差分反映 POST を保留したまま safety を崩し、
 * 解放後の reconcile がリストを書き換えないこと、および SHOP1 どおり sticky を
 * 保持（新 key dual-apply 防止）することを固定する。
 */
test("pending reconcile envelope does not apply after household safety changes", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  const nextMenuId = await regenerateWholeMenu(page, shoppingMenuId);

  let reconcilePosts = 0;
  const reconcileRejects: CapturedHttpReject[] = [];
  let releaseReconciles: () => void = () => undefined;
  const reconcilesReleased = new Promise<void>((resolve) => {
    releaseReconciles = resolve;
  });
  let released = false;

  await page.route("**/api/shopping-lists/*/reconcile", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    reconcilePosts += 1;
    if (!released) await reconcilesReleased;
    await captureRejectAndFulfill(route, reconcileRejects);
  });

  await page.goto(`/menus/${nextMenuId}`);
  await expect(page.getByRole("button", { name: "買い物リストの差分を見る" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "買い物リストの差分を見る" }).click();
  await expect(page.getByRole("heading", { name: "献立変更の差分" })).toBeVisible({
    timeout: 30_000,
  });
  // 差分が空だと pending の意味が薄い。alternate-menu 由来で追加が載ることを先に固定。
  await expect(page.getByRole("group", { name: /^追加 [1-9]\d*件$/u })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "選んだ変更を反映" }).click();

  // pending reconcile envelope が dual-write されること（POST 保留中）。SHOP3 / E2E1。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const match = (storage: Storage) =>
            Object.keys(storage).some((key) => key.startsWith("kondate:shopping:reconcile:"));
          return match(sessionStorage) && match(localStorage);
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(reconcilePosts).toBeGreaterThanOrEqual(1);

  await markFirstMemberAllergyUnconfirmed(page);
  // hard 入口を明示（create pending テストと同様、サーバ mutation だけでは同タブ hard が飛ばない）
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("kondate:household-safety-changed"));
  });
  released = true;
  releaseReconciles();

  await expect.poll(() => reconcileRejects.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expectSafetyContractReject(reconcileRejects, "reconcile after safety change");

  // SHOP1: safety 409 でも reconcile sticky を保持（新 key dual-apply 防止）。
  // suppress で auto-resume ループは止め、状態変化メッセージを出す。
  // E2E1: local+session の dual sticky（session のみでは multi-tab 正本欠落を見逃す）。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const match = (storage: Storage) =>
            Object.keys(storage).some((key) => key.startsWith("kondate:shopping:reconcile:"));
          return match(sessionStorage) && match(localStorage);
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(
    page.getByText("買い物リストの状態が変わりました。もう一度確認してください"),
  ).toBeVisible({ timeout: 15_000 });

  // メニュー側も fail closed（差分 CTA は使えない）
  await expect(
    page.getByRole("alert").filter({ hasText: /現在の(家族設定|安全条件)/u }),
  ).toBeVisible({ timeout: 30_000 });

  // /shopping: 使用中リストがあっても操作は閉じたまま（safety invalid）
  await page.goto("/shopping");
  await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("checkbox", { name: /を購入済みにする/u }).first()).toBeDisabled({
    timeout: 60_000,
  });
  // alternate 固有材料が apply されていないこと（保留中 reconcile が成功していない）
  await expect(page.getByRole("checkbox", { name: "きゅうりを購入済みにする" })).toHaveCount(0);
});
