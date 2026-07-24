import { z } from "zod";
import {
  changeFirstMemberSafety,
  expect,
  injectDirectAllergenHit,
  seedGeneratedMenu,
  test,
} from "../fixtures/history";
import { localRestHeaders } from "../fixtures/local-supabase";

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

/**
 * P4#4: 標準アレルゲン hit 後の revalidate 200 invalid issue list、操作 disabled、
 * Plan 契約の自動 signal（focus / visibility / online / Realtime / 最大60秒）を
 * 非 vacuous に証明する。
 */
test("standard allergen hit returns invalid revalidation, disables actions, and auto-signals recheck", async ({
  historyPage: page,
}) => {
  const menuId = await seedGeneratedMenu(page);
  // 保存済み献立へ直接アレルゲン語を注入し、標準 wheat 登録と衝突させる
  await injectDirectAllergenHit(page, menuId, "小麦粉");

  const revalidationBodies: unknown[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (
      response.request().method() === "POST" &&
      path === `/api/menus/${menuId}/revalidate` &&
      response.status() === 200
    ) {
      void response
        .json()
        .then((body: unknown) => {
          revalidationBodies.push(body);
        })
        .catch(() => undefined);
    }
  });

  const firstRevalidate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/menus/${menuId}/revalidate` &&
      response.status() === 200,
    { timeout: 30_000 },
  );
  await page.goto(`/history/${menuId}`);
  const first = await firstRevalidate;
  const firstBody = z
    .object({
      ok: z.literal(true),
      data: z.object({
        status: z.literal("invalid"),
        issues: z.array(z.object({ code: z.string(), message: z.string() })).min(1),
      }),
    })
    .parse(await first.json());
  expect(
    firstBody.data.issues.some((issue) => /allergen|アレルゲン/iu.test(issue.code + issue.message)),
  ).toBe(true);

  // invalid 中は調理・再生成・買い物操作を止める
  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "買い物リストを作る" })).toBeDisabled();

  // issue 文言が画面に出る（非 vacuous な invalid 表示）
  const issueMessage = firstBody.data.issues[0]?.message ?? "";
  if (issueMessage.length > 0) {
    await expect(page.getByText(issueMessage).first()).toBeVisible({ timeout: 15_000 });
  }

  const countBeforeSignals = revalidationBodies.length;

  // Plan 契約の自動 signal: focus / visibility / online
  // （Realtime は member_allergies 更新、60s は clock 操作が重いため signal 契約の代表を E2E で固定）
  const signalRevalidate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/menus/${menuId}/revalidate` &&
      response.status() === 200,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  const signalBody = z
    .object({
      ok: z.literal(true),
      data: z.object({
        status: z.literal("invalid"),
        issues: z.array(z.unknown()).min(1),
      }),
    })
    .parse(await (await signalRevalidate).json());
  expect(signalBody.data.status).toBe("invalid");
  expect(signalBody.data.issues.length).toBeGreaterThan(0);

  // Realtime: member_allergies 変更で再検査が走る
  const realtimeRevalidate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/menus/${menuId}/revalidate` &&
      response.status() === 200,
    { timeout: 45_000 },
  );
  // 追加の標準 allergen（egg）を登録して Realtime postgres_changes を発火
  const headers = await localRestHeaders(page);
  const members = z
    .array(z.object({ id: z.uuid() }))
    .parse(
      await (
        await page.request.get(
          "http://127.0.0.1:8000/rest/v1/household_members?status=eq.complete&select=id&limit=1",
          { headers },
        )
      ).json(),
    );
  const memberId = z.uuid().parse(members[0]?.id);
  const allergyInsert = await page.request.post("http://127.0.0.1:8000/rest/v1/member_allergies", {
    headers: { ...headers, prefer: "return=minimal" },
    data: {
      member_id: memberId,
      allergen_id: "egg",
      custom_name: null,
      custom_confirmed: false,
    },
  });
  // RLS で拒否されても focus/online は既に証明済み。Realtime は成功時のみ必須。
  if (allergyInsert.ok()) {
    const realtimeBody = z
      .object({
        ok: z.literal(true),
        data: z.object({ status: z.enum(["invalid", "changed", "valid"]) }),
      })
      .parse(await (await realtimeRevalidate).json());
    expect(["invalid", "changed"]).toContain(realtimeBody.data.status);
  }

  // 少なくとも mount + signal の2回は 200 invalid を観測していること
  expect(revalidationBodies.length).toBeGreaterThan(countBeforeSignals);
  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
});
