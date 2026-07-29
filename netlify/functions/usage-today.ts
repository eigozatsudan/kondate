import type { Config } from "@netlify/functions";
import { usageTodayDataSchema } from "../../shared/contracts/generation.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import {
  applyQuotaPlan,
  BillingEntitlementUnavailableError,
  limitsForPlan,
  loadEntitlement,
} from "./_shared/billing-entitlement.js";
import { getServerEnv } from "./_shared/env.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";
import { computeQuotaIdentityKey } from "./_shared/quota-identity.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/**
 * 生成行を作らず、当日の成功 / 外部 attempt / 短期窓 / 全体受付を返す。
 * 台帳への insert は行わない。
 * globalAvailable は予約側と同じ GLOBAL_DAILY_AI_LIMIT を渡して計算する。
 * identity 日次はサーバ計算の identity_key で読む（クライアント指定不可）。
 * plan / plusEntitled は RPC に無く、entitlement から Function が merge する（ADV-6）。
 */
export default async function usageToday(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const user = await requireUserWithEmail(request);
    const env = getServerEnv();
    const identityKey = computeQuotaIdentityKey(env.quotaIdentityHmacKey, user.email);

    let entitlement;
    try {
      entitlement = await loadEntitlement(user.userId);
    } catch (error: unknown) {
      if (error instanceof BillingEntitlementUnavailableError || error instanceof HttpError) {
        throw new HttpError(
          503,
          "billing_entitlement_unavailable",
          "プラン情報を確認できませんでした。しばらくしてからお試しください。",
        );
      }
      throw new HttpError(
        503,
        "billing_entitlement_unavailable",
        "プラン情報を確認できませんでした。しばらくしてからお試しください。",
      );
    }

    // 枠が Plus か = applyQuotaPlan 結果（usage の plusEntitled 表示と同義）
    const quotaPlan = applyQuotaPlan(entitlement, env.billingEnabled);
    const limits = limitsForPlan(quotaPlan);
    const plusEntitled = quotaPlan === "plus";

    const { data, error } = await getSupabaseAdmin().rpc("get_ai_usage_today", {
      p_user_id: user.userId,
      p_identity_key: identityKey,
      p_user_limit: limits.successPerDay,
      p_attempt_limit: limits.attemptsPerDay,
      p_short_window_limit: limits.shortWindowLimit,
      p_global_limit: env.openRouter.globalDailyLimit,
    });
    if (error !== null) throw error;

    // ローカル個人枠無効時は wire 形を保ったまま個人枠をフル残にする（global は実値）。
    if (env.aiQuotaDisabled) {
      const rpcBody = data as {
        success?: { limit?: number };
        attempts?: { limit?: number };
        shortWindow?: { limit?: number };
        globalAvailable?: boolean;
        retryAt?: string | null;
      };
      const projected = usageTodayDataSchema.parse({
        plan: quotaPlan,
        plusEntitled,
        success: {
          consumed: 0,
          limit: limits.successPerDay,
          remaining: limits.successPerDay,
        },
        attempts: {
          sent: 0,
          limit: limits.attemptsPerDay,
          remaining: limits.attemptsPerDay,
        },
        shortWindow: {
          sent: 0,
          limit: limits.shortWindowLimit,
          remaining: limits.shortWindowLimit,
          retryAt: null,
        },
        globalAvailable: rpcBody.globalAvailable === true,
        retryAt: rpcBody.globalAvailable === true ? null : (rpcBody.retryAt ?? null),
      });
      return json(200, { ok: true, data: projected });
    }

    const merged = usageTodayDataSchema.parse({
      ...(typeof data === "object" && data !== null ? data : {}),
      plan: quotaPlan,
      plusEntitled,
    });
    return json(200, { ok: true, data: merged });
  } catch (error) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/usage/today",
  method: "GET",
};
