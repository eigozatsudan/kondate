import type { Config } from "@netlify/functions";
import { usageTodayDataSchema } from "../../shared/contracts/generation.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import { getServerEnv } from "./_shared/env.js";
import { handleError, json, methodNotAllowed } from "./_shared/http.js";
import { computeQuotaIdentityKey } from "./_shared/quota-identity.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/**
 * 生成行を作らず、当日の成功 / 外部 attempt / 短期窓 / 全体受付を返す。
 * 台帳への insert は行わない。
 * globalAvailable は予約側と同じ GLOBAL_DAILY_AI_LIMIT を渡して計算する。
 * identity 日次はサーバ計算の identity_key で読む（クライアント指定不可）。
 */
export default async function usageToday(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const user = await requireUserWithEmail(request);
    const env = getServerEnv();
    const identityKey = computeQuotaIdentityKey(env.quotaIdentityHmacKey, user.email);
    const { data, error } = await getSupabaseAdmin().rpc("get_ai_usage_today", {
      p_user_id: user.userId,
      p_identity_key: identityKey,
      p_global_limit: env.openRouter.globalDailyLimit,
    });
    if (error !== null) throw error;
    const parsed = usageTodayDataSchema.parse(data);
    return json(200, { ok: true, data: parsed });
  } catch (error) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/usage/today",
  method: "GET",
};
