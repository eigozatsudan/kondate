import {
  expect,
  readRemainingQuota,
  requestDishRegeneration,
  requestWholeRegeneration,
  seedGeneratedIdeaMenu,
  seedGeneratedMenu,
  setMockScenario,
  test,
} from "../fixtures/history";
import { localRestHeaders } from "../fixtures/local-supabase";
import { z } from "zod";

// 認証・生成・再生成・再検証を直列で含むため既定 30s では足りない
// idea 経路は dish + whole の 2 回再生成を含む
test.setTimeout(240_000);

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

test("idea history shows badge, notice, permitted actions, regenerates as idea without shopping", async ({
  // completed 家族あり下書きだと idea 切替の中間状態が draft CHECK に弾かれやすい。
  // welcome から idea を選ぶ authenticated 経路（generation-recovery と同型）を使う。
  authenticatedPage: page,
}) => {
  const shoppingRequests: string[] = [];
  const revalidationRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/shopping-lists/")) shoppingRequests.push(path);
    if (/^\/api\/menus\/[^/]+\/revalidate$/u.test(path)) revalidationRequests.push(path);
  });

  // idea 生成（servings=1 の固定 fixture と整合）。welcome→idea で skipped へ進む。
  await setMockScenario(page, "idea-servings-1");
  // authenticatedPage は /welcome 上。seedGeneratedIdeaMenu は /planner 起点なので
  // welcome の主操作から idea 導線へ入ってから seed と同じ wizard を踏む。
  await expect(page.getByRole("button", { name: "献立アイデアを考える" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "献立アイデアを考える" }).click();
  await expect(page).toHaveURL(/\/planner/u);
  const sourceMenuId = await seedGeneratedIdeaMenu(page, 1);

  // 結果画面: notice + 許可操作、買い物なし
  await expect(page.getByText("家族条件を使用していません")).toBeVisible();
  await expect(page.getByRole("button", { name: "これに決めた" })).toBeVisible();
  await expect(page.getByRole("button", { name: "お気に入りに追加" })).toBeVisible();
  await expect(page.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "冷蔵庫へ反映" })).toBeVisible();
  await expect(page.getByRole("button", { name: "買い物リストを作る" })).toHaveCount(0);

  // 冷蔵庫へ反映: tip を開き post-cook 操作導線を露出する（used pantry が無い fixture では
  // 「調理後の冷蔵庫」section は出ないが、idea でも tip 自体は許可操作として動く）
  await page.getByRole("button", { name: "冷蔵庫へ反映" }).click();
  await expect(
    page.getByText("調理後の冷蔵庫操作は献立本文の「調理後の冷蔵庫」から行えます。"),
  ).toBeVisible();

  // 一品再生成シート: idea では child_friendly が無い
  await page.getByRole("button", { name: "この一品だけ別案にする" }).click();
  await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  await page.getByRole("button", { name: "やめる" }).click();

  // お気に入り
  await page.getByRole("button", { name: "お気に入りに追加" }).click();
  await expect(page.getByRole("button", { name: "お気に入りを外す" })).toBeVisible({
    timeout: 15_000,
  });

  // 採用
  await page.getByRole("button", { name: "これに決めた" }).click();

  // 履歴: idea badge
  await page.goto("/history");
  await expect(page.getByText("アイデア")).toBeVisible({ timeout: 15_000 });

  // 詳細: notice + child_friendly 不在
  await page.goto(`/history/${sourceMenuId}`);
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
  await expect(page.getByRole("radio", { name: "子どもが食べやすく" })).toHaveCount(0);
  await page.getByRole("button", { name: "やめる" }).click();

  // dish 再生成後も idea を維持（家族 member 無しの idea 一品 fixture）
  await setMockScenario(page, "idea-dish-replacement-1");
  await requestDishRegeneration(page, sourceMenuId, "simpler", { targetMode: "idea" });
  await expect(page).toHaveURL(new RegExp(`/menus/(?!${sourceMenuId})[0-9a-f-]{36}`, "iu"), {
    timeout: 60_000,
  });
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "買い物リストを作る" })).toHaveCount(0);
  // 置換後の主菜名が表示される（dish-replacement 系 fixture）。tab と h2 の両方に出るため heading で一意化。
  await expect(page.getByRole("heading", { name: "鶏肉のさっぱり煮" })).toBeVisible({
    timeout: 15_000,
  });

  const dishMenuId = /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1];
  if (dishMenuId === undefined) throw new Error("dish regenerated menu id missing");
  const headers = await localRestHeaders(page);
  const dishMenuLookup = await page.request.get(
    `http://127.0.0.1:8000/rest/v1/menus?id=eq.${dishMenuId}&select=target_mode`,
    { headers },
  );
  const dishMenuRows = z
    .array(z.object({ target_mode: z.string() }))
    .parse(await dishMenuLookup.json());
  expect(dishMenuRows[0]?.target_mode).toBe("idea");

  // whole 再生成後も idea を維持（servings=1 の idea 別案 fixture）。元 source から実行する。
  await setMockScenario(page, "idea-alternate-menu-1");
  await requestWholeRegeneration(page, sourceMenuId, "simpler", { targetMode: "idea" });
  await expect(page).toHaveURL(new RegExp(`/menus/(?!${sourceMenuId})[0-9a-f-]{36}`, "iu"), {
    timeout: 60_000,
  });
  await expect(page.getByText("家族条件を使用していません")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "買い物リストを作る" })).toHaveCount(0);

  const newMenuId = /\/menus\/([0-9a-f-]{36})/iu.exec(new URL(page.url()).pathname)?.[1];
  if (newMenuId === undefined) throw new Error("regenerated menu id missing");
  const menuLookup = await page.request.get(
    `http://127.0.0.1:8000/rest/v1/menus?id=eq.${newMenuId}&select=target_mode`,
    { headers },
  );
  const menuRows = z.array(z.object({ target_mode: z.string() })).parse(await menuLookup.json());
  expect(menuRows[0]?.target_mode).toBe("idea");

  // result / history detail / dish・whole 再生成後の各地点で shopping・family revalidate は 0
  expect(shoppingRequests).toHaveLength(0);
  expect(revalidationRequests).toHaveLength(0);
  const shoppingSessionKeys = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((key) => key.startsWith("kondate:shopping:")),
  );
  expect(shoppingSessionKeys).toHaveLength(0);
});
