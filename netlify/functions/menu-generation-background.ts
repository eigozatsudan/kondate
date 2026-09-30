import type { Config } from "@netlify/functions";
import { MENU_BACKGROUND_HARD_DEADLINE_MS } from "../../shared/contracts/function-budget.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import { HttpError } from "./_shared/http.js";
import { getServerEnv } from "./_shared/env.js";
import { verifyMenuBackgroundRequest } from "./_shared/menu-background-signature.js";
import { executeMenuBackground } from "./_shared/menu-background.js";
import { readLocalMockScenario } from "./_shared/local-mock-scenario.js";
import { runWithRequestDeadline } from "./_shared/request-deadline.js";

/** Netlify の即時 202 と独立した処理。HTTP レスポンスを結果通知には使用しない。 */
export default async function menuGenerationBackground(request: Request): Promise<void> {
  if (request.method !== "POST") return;
  try {
    await runWithRequestDeadline(performance.now() + MENU_BACKGROUND_HARD_DEADLINE_MS, async () => {
      const envelope = await verifyMenuBackgroundRequest(
        request,
        getServerEnv().generationIntegrity.requestHmacKey,
      );
      if (envelope === null) return;
      const user = await requireUserWithEmail(request);
      const { command, token } = envelope;
      // claim 前の一時障害だけ再試行する。恒久拒否は下で正常終了させる。
      // claim 後は SQL が再実行を拒み、外部への二重送信を防ぐ。
      await executeMenuBackground(user, command, token, readLocalMockScenario(request));
    });
  } catch (error) {
    // 恒久的な入力/認証拒否の再試行で Auth/DB 負荷を増幅させない。
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) return;
    throw error;
  }
}

export const config: Config = {
  background: true,
  method: "POST",
  // dispatch の共通送信元 IP を考慮した運用余裕。台帳 quota の数学的上限ではない。
  rateLimit: { windowLimit: 5000, windowSize: 180, aggregateBy: ["ip"] },
};
