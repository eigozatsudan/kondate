/**
 * setup project 専用: 製品経路で番号を送り 6 マスに入れて 1 ユーザを作り
 * onboarding を seed し、storageState を e2e/.auth/user.json へ保存する。
 * メール URL は goto しない。mobile/desktop の grepInvert や ephemeral fixture には
 * 載せない（base test を使う）。
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { EMAIL_OTP_DIGIT_ARIA_LABELS } from "../../src/features/auth/email-otp-copy";
import { requestEmailOtpAndReadCode } from "../fixtures/auth";
import { seedPwaInstallTipDismissed } from "../fixtures/pwa-install-tip";
import { seedCompletedOnboardingState } from "../fixtures/seed-onboarding";
import { STORAGE_STATE_PATH } from "../fixtures/session-auth";

test("authenticate, seed completed onboarding, save storageState", async ({ page }) => {
  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });

  // 最初の goto より前に context へ書く。storageState() はその結果を保存するだけ。
  await seedPwaInstallTipDismissed(page.context());

  // ランごとに一意。固定 email だと前回 E2E の DB 行が残り seed insert が衝突する。
  const setupAuthEmail = `e2e-setup-reused-${String(Date.now())}@example.invalid`;
  const code = await requestEmailOtpAndReadCode(page, setupAuthEmail);
  for (const [index, label] of EMAIL_OTP_DIGIT_ARIA_LABELS.entries()) {
    await page.getByLabel(label).fill(code.charAt(index));
  }
  // 番号確認成功は returnTo=/planner。メール URL は開かない。
  await expect(page).toHaveURL((url) => url.pathname === "/planner", { timeout: 30_000 });

  // UI onboarding は seed で完了状態を投入（Task 6）
  await seedCompletedOnboardingState(page);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
