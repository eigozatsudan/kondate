import {
  createShoppingListRequestSchema,
  reconcileShoppingListRequestSchema,
} from "../../shared/contracts/shopping";
import {
  createListFromMenu,
  deferMatchingRequest,
  expect,
  markFirstMemberAllergyUnconfirmed,
  regenerateWholeMenu,
  test,
} from "../fixtures/shopping";

// 献立生成を伴うため既定の30秒では足りない（既存の履歴系specと同じ扱い）。
test.setTimeout(180_000);

test("reuses one idempotency key after the first response is lost", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
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
});

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
  await expect(page.getByRole("button", { name: "買い物リストを作る" })).toBeDisabled();
});

test("disables shopping actions immediately after member or allergy mutation", async ({
  authenticatedPage: shoppingPage,
  shoppingMenuId,
}) => {
  await createListFromMenu(shoppingPage, shoppingMenuId);
  const settingsPage = await shoppingPage.context().newPage();
  await settingsPage.goto("/settings");
  const reload = await deferMatchingRequest(shoppingPage, "**/rest/v1/shopping_lists*");
  const sourceRevalidation = await deferMatchingRequest(
    shoppingPage,
    "**/api/shopping-lists/*/revalidate",
  );
  // 設計書の「表示名 / 家族設定を保存」は本リポジトリの設定UIに存在しない。
  // 同じ household_members 更新を行う実コントロール（呼び名 + 設定完了）へ読み替える。
  await settingsPage.getByLabel("呼び名").fill("更新後の家族");
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
});

test("fails closed on a server-only household change without browser events", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  await page.goto("/shopping");
  const revalidation = await deferMatchingRequest(page, "**/api/shopping-lists/*/revalidate");
  await markFirstMemberAllergyUnconfirmed(page);
  await expect(page.getByRole("checkbox", { name: /購入済みにする/u }).first()).toBeDisabled({
    timeout: 90_000,
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
  await expect(page.getByRole("button", { name: "買い物リストとの差分を確認" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "買い物リストとの差分を確認" }).click();
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
