/**
 * 週献立（Plus）の受け入れフロー。
 * 週献立の Plus ゲートはブラウザ側モック（page.route）では越えられない
 * （applyQuotaPlan が env.billingEnabled に短絡する。compose.e2e.yaml で
 * BILLING_ENABLED=true にした上で、対象ユーザーだけを Plus として seed する）。
 *
 * ephemeral ユーザー（このテスト専用）を使う。共有 storageState ユーザーは
 * Free ケース（weekly-plan-locked.spec.ts）専用に残し、ここでは Plus にしない。
 */
import { z } from "zod";
import { expect, test } from "../fixtures/auth";
import { seedPlusSubscription } from "../fixtures/acceptance";
import { accessTokenFromPage } from "../fixtures/local-supabase";

const jwtPayloadSchema = z.object({ sub: z.uuid() });

/** page 上の Supabase access_token（JWT）から user_id（sub）を取る。service key は使わない。 */
async function currentUserId(page: Parameters<typeof accessTokenFromPage>[0]): Promise<string> {
  const accessToken = await accessTokenFromPage(page);
  const payloadSegment = accessToken.split(".")[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    throw new Error("access token has no payload segment");
  }
  const json: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  return jwtPayloadSchema.parse(json).sub;
}

test.setTimeout(180_000);

test.describe("weekly plan", () => {
  // ephemeral ユーザー（このテスト専用）。このユーザーだけを Plus に seed する。
  test("Plus: create → result → tap a day → planner draft is filled", async ({
    completedOnboardingPage,
  }) => {
    const page = completedOnboardingPage;
    // Function 側の billing entitlement 判定（サーバ RPC）に届くよう、
    // page を触る前に private.billing_subscriptions を直接 seed する。
    await seedPlusSubscription(await currentUserId(page));

    await page.goto("/weekly");
    await expect(page.getByRole("heading", { level: 1, name: "今週の献立" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "今週の献立をつくる" }).click();
    // フォーム画面自身にも <h1>今週の献立</h1> があるため、heading だけでは
    // 遷移していなくても緑になる。URL で結果画面到達を固定する。
    await expect(page).toHaveURL(/\/weekly\/[0-9a-f-]{36}/u, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "この日の献立を作る" }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "この日の献立を作る" }).first().click();
    await expect(page).toHaveURL(/\/planner/u, { timeout: 15_000 });
    await expect(page.getByRole("textbox", { name: "自由メモ" })).toHaveValue("主菜: 固定主菜1");
  });
});
