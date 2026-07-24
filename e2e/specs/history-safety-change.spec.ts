import { z } from "zod";
import {
  changeFirstMemberSafety,
  expect,
  injectDirectAllergenHit,
  seedGeneratedMenu,
  test,
} from "../fixtures/history";
import { accessTokenFromPage } from "../fixtures/local-supabase";

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

/** POST /api/menus/:menuId/revalidate の 200 応答を待つ（signal 単位で独立に張る） */
function waitForRevalidate200(
  page: import("@playwright/test").Page,
  menuId: string,
  timeout = 30_000,
) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/menus/${menuId}/revalidate` &&
      response.status() === 200,
    { timeout },
  );
}

const invalidRevalidationSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.literal("invalid"),
    issues: z.array(z.object({ code: z.string(), message: z.string() })).min(1),
  }),
});

/**
 * service DB（pg）で member_allergies を必ず挿入し、Realtime postgres_changes を発火する。
 * ブラウザ JWT / RLS 経由だと拒否され得るため soft-skip せず必須経路にする。
 */
async function insertStandardAllergyViaPg(userId: string, memberId: string, allergenId: string) {
  const { readFile } = await import("node:fs/promises");
  const { Client } = await import("pg");
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const password = z
    .string()
    .min(1)
    .parse(/^POSTGRES_PASSWORD=(.+)$/mu.exec(envText)?.[1]?.trim());
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:54322/postgres?sslmode=disable`,
  });
  await client.connect();
  try {
    // 既に同一標準アレルゲンがある場合は更新で WAL 変更を起こす
    const updated = await client.query(
      `update public.member_allergies
          set custom_aliases = array_append(coalesce(custom_aliases, '{}'::text[]), 'e2e-realtime')
        where member_id = $1::uuid
          and user_id = $2::uuid
          and allergen_id = $3
        returning id`,
      [memberId, userId, allergenId],
    );
    if ((updated.rowCount ?? 0) > 0) {
      return;
    }
    const inserted = await client.query(
      `insert into public.member_allergies (
         member_id, user_id, allergen_id, custom_name, custom_confirmed
       ) values ($1::uuid, $2::uuid, $3, null, false)
       returning id`,
      [memberId, userId, allergenId],
    );
    if ((inserted.rowCount ?? 0) !== 1) {
      throw new Error(`member_allergies seed failed for allergen ${allergenId}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * P4#4: 標準アレルゲン hit 後の revalidate 200 invalid issue list、操作 disabled、
 * Plan 契約の自動 signal（focus / visibility / online / Realtime）を
 * 各 signal 独立の waitForResponse で非 vacuous に証明する。最大60秒は unit 側。
 */
test("standard allergen hit returns invalid revalidation, disables actions, and auto-signals recheck", async ({
  historyPage: page,
}) => {
  const menuId = await seedGeneratedMenu(page);
  // 保存済み献立へ直接アレルゲン語を注入し、標準 wheat 登録と衝突させる
  await injectDirectAllergenHit(page, menuId, "小麦粉");

  const firstRevalidate = waitForRevalidate200(page, menuId);
  await page.goto(`/history/${menuId}`);
  const first = await firstRevalidate;
  const firstBody = invalidRevalidationSchema.parse(await first.json());
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

  // --- Plan 契約の自動 signal を独立に証明（バッチしない） ---
  // 1) focus
  const focusRevalidate = waitForRevalidate200(page, menuId);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  const focusBody = invalidRevalidationSchema.parse(await (await focusRevalidate).json());
  expect(focusBody.data.issues.length).toBeGreaterThan(0);

  // 2) visibilitychange（visible 復帰）
  const visibilityRevalidate = waitForRevalidate200(page, menuId);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const visibilityBody = invalidRevalidationSchema.parse(await (await visibilityRevalidate).json());
  expect(visibilityBody.data.issues.length).toBeGreaterThan(0);

  // 3) online
  const onlineRevalidate = waitForRevalidate200(page, menuId);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });
  const onlineBody = invalidRevalidationSchema.parse(await (await onlineRevalidate).json());
  expect(onlineBody.data.issues.length).toBeGreaterThan(0);

  // 4) Realtime: member_allergies 変更は pg 経由で必須（RLS soft-skip 禁止）
  const token = await accessTokenFromPage(page);
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { sub?: string };
  const userId = z.uuid().parse(payload.sub);

  const { readFile } = await import("node:fs/promises");
  const { Client } = await import("pg");
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const password = z
    .string()
    .min(1)
    .parse(/^POSTGRES_PASSWORD=(.+)$/mu.exec(envText)?.[1]?.trim());
  const lookup = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:54322/postgres?sslmode=disable`,
  });
  await lookup.connect();
  let memberId: string;
  try {
    const members = await lookup.query<{ id: string }>(
      `select id::text as id from public.household_members
        where user_id = $1::uuid and status = 'complete'
        order by created_at asc
        limit 1`,
      [userId],
    );
    memberId = z.uuid().parse(members.rows[0]?.id);
  } finally {
    await lookup.end();
  }

  const realtimeRevalidate = waitForRevalidate200(page, menuId, 45_000);
  // 追加の標準 allergen（egg）を service DB で登録し Realtime を必須発火
  await insertStandardAllergyViaPg(userId, memberId, "egg");
  const realtimeBody = z
    .object({
      ok: z.literal(true),
      data: z.object({ status: z.enum(["invalid", "changed", "valid"]) }),
    })
    .parse(await (await realtimeRevalidate).json());
  expect(["invalid", "changed"]).toContain(realtimeBody.data.status);

  await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
});
