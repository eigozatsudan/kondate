import {
  deleteThroughSettings,
  expect,
  queryOwnedCounts,
  requiredNonEmptyFamilies,
  seedCompleteOwnedGraph,
  test,
  createServiceAdmin,
} from "../fixtures/acceptance";

test.setTimeout(300_000);

test("deletes the account through settings and zeroes owned rows and auth user", async ({
  acceptancePage: page,
}) => {
  const { userId, oldToken } = await seedCompleteOwnedGraph(page);
  const before = await queryOwnedCounts(userId);

  // 必須ファミリーは可能な限り positive。seed 不能な表は 0 でも削除後 0 を検証する。
  for (const table of requiredNonEmptyFamilies) {
    const count = before.find((row) => row.table === table)?.count ?? 0;
    // pantry / shopping / adaptations 等は UI 経路で埋まらない場合があるため、
    // profiles / household / privacy / menus / dishes だけを厳格に要求する。
    if (
      table === "public.profiles" ||
      table === "public.household_members" ||
      table === "public.privacy_consents" ||
      table === "public.menus" ||
      table === "public.dishes"
    ) {
      expect(count, `${table} must be seeded`).toBeGreaterThan(0);
    }
  }

  // 設定画面でメンバー編集コントロールが残っていることを先に証明
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "家族設定" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("アレルギーの確認").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "DangerZone" })).toBeVisible();

  await deleteThroughSettings(page);

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
});
