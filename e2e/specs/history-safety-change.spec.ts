import { changeFirstMemberSafety, expect, seedGeneratedMenu, test } from "../fixtures/history";

test.setTimeout(180_000);

test("automatically revalidates on mount and blocks stale history after safety changes", async ({
  historyPage: page,
}) => {
  const menuId = await seedGeneratedMenu(page);
  await changeFirstMemberSafety(page);
  await page.goto(`/history/${menuId}`);
  // unconfirmed は snapshot unavailable → 「安全条件を読み込めませんでした」
  await expect(page.getByRole("alert")).toContainText(/現在の(家族設定|安全条件)/u, {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "買い物リストを作る" })).toBeDisabled();
});
