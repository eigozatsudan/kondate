import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { privacyNoticeVersion } from "../../shared/contracts/domain";
import { accessTokenFromPage } from "./local-supabase";

const userIdSchema = z.uuid();

const jwtPayloadSchema = z.object({
  sub: userIdSchema,
});

/**
 * ページ上の Supabase access_token（JWT）から user_id（sub）を取る。
 * service key は page に載せない。
 */
function userIdFromAccessToken(accessToken: string): string {
  const payloadSegment = accessToken.split(".")[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    throw new Error("access token has no payload segment");
  }
  const json: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  return jwtPayloadSchema.parse(json).sub;
}

/** Auth Admin（service role）。secret は .env のみ、page には渡さない。 */
async function createServiceAdmin() {
  const envText = await readFile("/workspace/.env", "utf8").catch(async () =>
    readFile(".env", "utf8"),
  );
  const serviceRoleKey = z
    .string()
    .min(20)
    .parse(/^SERVICE_ROLE_KEY=(.+)$/mu.exec(envText)?.[1]?.trim());
  return createClient("http://127.0.0.1:8000", serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * ログイン済み page のユーザに対し、最低限の家族1名・allergy none・
 * onboarding 完了・privacy 同意相当を service role で投入し、
 * /planner で使える状態にする。page に service key を渡さない。
 *
 * UI 経路（onboarding.spec / full-journey household）は seed に置き換えない。
 * completedOnboardingPage など「完了済み前提」の fixture 専用。
 */
export async function seedCompletedOnboardingState(page: Page): Promise<void> {
  const accessToken = await accessTokenFromPage(page);
  const userId = userIdFromAccessToken(accessToken);
  const admin = await createServiceAdmin();

  // 1) 完了メンバーを先に入れる（set_onboarding_status 相当の前提を DB 上で満たす）。
  // portion_size / spice_level は DB の status=complete CHECK では任意だが、
  // 生成の requireCompleteMember / complete_household_member は非 null 必須。
  // UI 再編集で偶然埋まる経路に依存しないよう seed で正値を入れる。
  const { error: memberError } = await admin.from("household_members").insert({
    user_id: userId,
    status: "complete",
    age_band: "adult",
    portion_size: "regular",
    spice_level: "regular",
    allergy_status: "none",
    unsupported_diet_status: "none",
    display_name: "家族1",
    sort_order: 0,
  });
  if (memberError !== null) {
    throw new Error(`household_members seed failed: ${memberError.message}`);
  }

  // 2) profile を complete に（制約: complete 時は onboarding_completed_at 必須）
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      onboarding_status: "complete",
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (profileError !== null) {
    throw new Error(`profiles onboarding complete seed failed: ${profileError.message}`);
  }

  // 3) 現行 privacy 同意（生成 API が privacyNoticeVersion を要求する）
  const { error: privacyError } = await admin.from("privacy_consents").insert({
    user_id: userId,
    notice_version: privacyNoticeVersion,
  });
  if (privacyError !== null) {
    throw new Error(`privacy_consents seed failed: ${privacyError.message}`);
  }

  // 4) SPA を /planner へ。welcome へ戻らないことを固定する。
  await page.goto("/planner");
  await expect(page).toHaveURL((url) => url.pathname === "/planner", { timeout: 30_000 });
  // settings 等と同じ「完了済み planner」の最低限 UI 固定
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible({
    timeout: 15_000,
  });
}
