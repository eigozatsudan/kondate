import { z } from "zod";
import { createShoppingListRequestSchema } from "../../shared/contracts/shopping";
import { localRestHeaders } from "../fixtures/local-supabase";
import {
  addManualItem,
  createListFromMenu,
  deleteMenuHistoryGroup,
  expect,
  markFirstItemPurchased,
  regenerateWholeMenu,
  test,
} from "../fixtures/shopping";

// 献立生成を伴うため既定の30秒では足りない（既存の履歴系specと同じ扱い）。
test.setTimeout(180_000);

test("retains checked/manual items and label snapshots after history deletion", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  const first = await markFirstItemPurchased(page);
  await addManualItem(page, "キッチンペーパー");
  await deleteMenuHistoryGroup(page, shoppingMenuId);
  await page.goto("/shopping");
  await expect(page.getByText("キッチンペーパー")).toBeVisible();
  await expect(first).toBeChecked();
  await expect(page.getByText("現在の条件では確認できない過去の警告")).toBeVisible();
  await expect(page.getByText("加工品は原材料表示を確認")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "＋ 項目を追加" })).toBeDisabled();
});

test("shows server-owned diff and preserves protected rows", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  await createListFromMenu(page, shoppingMenuId);
  const checked = await markFirstItemPurchased(page);
  const nextMenuId = await regenerateWholeMenu(page, shoppingMenuId);
  await page.goto(`/menus/${nextMenuId}`);
  await page.getByRole("button", { name: "買い物リストとの差分を確認" }).click();
  await expect(page.getByText("購入済み・手動変更の項目はそのまま残します。")).toBeVisible();
  await page.getByRole("button", { name: "選んだ変更を反映" }).click();
  await page.goto("/shopping");
  await expect(checked).toBeChecked();
});

// Plan 7 Task 8: create 成功後に source を削除しても同一 mutation key は保存済み成功を返す。
// idea 献立への新規 key 422 は generation-recovery / history の idea E2E（shopping request 0）と
// service/HTTP/pgTAP の idea_menu_not_supported 境界で固定する。
// completed 家族あり fixture 上での idea 切替は draft CHECK 中間状態で弾かれやすい
// （history-regeneration の idea 経路コメントと同型）ため、ここでは replay 不変条件に絞る。
test("replays saved create after source deletion with the same mutation key", async ({
  authenticatedPage: page,
  shoppingMenuId,
}) => {
  const createBodies: string[] = [];
  await page.route("**/api/shopping-lists/from-menu", async (route) => {
    createBodies.push(route.request().postData() ?? "");
    await route.continue();
  });
  await createListFromMenu(page, shoppingMenuId);
  expect(createBodies.length).toBeGreaterThanOrEqual(1);
  const firstCommand = createShoppingListRequestSchema.parse(
    JSON.parse(createBodies[0] ?? "{}") as unknown,
  );

  await deleteMenuHistoryGroup(page, shoppingMenuId);
  const headers = await localRestHeaders(page);
  const replay = await page.request.post("http://127.0.0.1:5173/api/shopping-lists/from-menu", {
    headers: {
      ...headers,
      origin: "http://127.0.0.1:5173",
    },
    data: firstCommand,
  });
  expect(replay.ok()).toBe(true);
  const replayJson = z
    .object({
      ok: z.literal(true),
      data: z.object({
        listId: z.uuid(),
        version: z.number().int().positive(),
        replayed: z.boolean(),
      }),
    })
    .parse(await replay.json());
  expect(replayJson.data.replayed).toBe(true);
  // リスト本体は source 削除後も残る
  await page.goto("/shopping");
  await expect(page.getByRole("heading", { name: "買い物リスト" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /を購入済みにする/u }).first()).toBeVisible({
    timeout: 30_000,
  });
});
