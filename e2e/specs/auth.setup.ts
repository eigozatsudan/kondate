/**
 * setup project 専用: magic-link で 1 ユーザを作り onboarding を seed し、
 * storageState を e2e/.auth/user.json へ保存する。
 * mobile/desktop の grepInvert や ephemeral fixture には載せない（base test を使う）。
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { requestMagicLinkAndReadUrl } from "../fixtures/auth";
import { seedCompletedOnboardingState } from "../fixtures/seed-onboarding";
import { STORAGE_STATE_PATH } from "../fixtures/session-auth";

test("authenticate, seed completed onboarding, save storageState", async ({ page }) => {
  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });

  // ランごとに一意。固定 email だと前回 E2E の DB 行が残り seed insert が衝突する。
  const setupAuthEmail = `e2e-setup-reused-${String(Date.now())}@example.invalid`;
  const magicLink = await requestMagicLinkAndReadUrl(page, setupAuthEmail);
  await page.goto(magicLink);
  // magic-link 経由は /planner 着地（sanitizeReturnPath）。セッション確立を待つ。
  await expect(page).toHaveURL((url) => url.pathname === "/planner", { timeout: 30_000 });

  // UI onboarding は seed で完了状態を投入（Task 6）
  await seedCompletedOnboardingState(page);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
