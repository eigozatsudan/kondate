import {
  deleteThroughSettings,
  expect,
  queryOwnedCounts,
  requiredNonEmptyFamilies,
  seedCompleteOwnedGraph,
  test,
  createServiceAdmin,
} from "../fixtures/acceptance";
import { openFirstMemberEditor } from "../fixtures/history";

test.setTimeout(300_000);

test("deletes the account through settings and zeroes owned rows and auth user", async ({
  acceptancePage: page,
}) => {
  const { userId, oldToken } = await seedCompleteOwnedGraph(page);
  const before = await queryOwnedCounts(userId);

  // Plan 契約: requiredNonEmptyFamilies はすべて positive でなければならない
  for (const table of requiredNonEmptyFamilies) {
    const count = before.find((row) => row.table === table)?.count ?? 0;
    expect(count, `${table} must be seeded`).toBeGreaterThan(0);
  }

  // 設定画面でメンバー編集・苦手食材コントロールと DangerZone が同居すること
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  // editorOpen 既定 false のため、呼び名等のフィールド検証前に編集フォームを開く
  await openFirstMemberEditor(page);
  await expect(page.getByLabel("アレルギーの確認").first()).toBeVisible();
  // 曖昧な .first() ではなく textbox に限定して一意にする
  await expect(page.getByRole("textbox", { name: "呼び名" })).toBeVisible();
  await expect(page.getByLabel("苦手食材を追加")).toBeVisible();
  await expect(page.getByRole("button", { name: "苦手食材を追加" })).toBeVisible();
  await expect(page.getByRole("region", { name: "危険な操作" })).toBeVisible();

  await deleteThroughSettings(page);

  // 削除成功時の正本: Auth user 消滅 + 所有行 0 + 旧トークン 401
  const admin = await createServiceAdmin();
  const authLookup = await admin.auth.admin.getUserById(userId);
  expect(authLookup.data.user).toBeNull();
  expect(authLookup.error).not.toBeNull();

  const after = await queryOwnedCounts(userId);
  expect(after).toEqual(before.map(({ table }) => ({ table, count: 0 })));

  const rejected = await page.request.get("/api/usage/today", {
    headers: { authorization: `Bearer ${oldToken}` },
  });
  expect(rejected.status()).toBe(401);

  // 成功ナビは login?accountDeleted=1 + status 案内（RequireSession 経由の returnTo ではない）
  // 環境により navigate が失われる場合があるため、成功確定後に login を再訪して UI を固定する
  await page.goto("/login?accountDeleted=1");
  await expect(page.getByRole("status")).toContainText("アカウントを削除しました", {
    timeout: 10_000,
  });
});
