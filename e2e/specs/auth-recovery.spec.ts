import { expect, test } from "../fixtures/auth";

test(
  "Google cancel and expired links return actionable login choices",
  { tag: ["@smoke"] },
  async ({ page }) => {
    // C7: callback 許可クエリに returnTo は無い（unknown key → unbound_callback）。
    // returnTo は stored flow 由来。error 系は flow 無しでも oauth_cancelled / expired へ写る。
    // callback→login 描画は並列負荷で 5s 既定を超え得る（oauth-mock / auth-callback-security と同型 15s）。
    await page.goto("/auth/callback?error=access_denied");
    await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible({
      timeout: 15_000,
    });
    await page.goto("/auth/callback?error=access_denied&error_code=otp_expired");
    await expect(page.getByText(/期限切れか、すでに使用/u)).toBeVisible({
      timeout: 15_000,
    });
    // leftover / 期限切れ leave は idle の新コピー。メール callback ケースは置かない。
    await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "番号をメールで受け取る" })).toBeVisible({
      timeout: 15_000,
    });
  },
);
