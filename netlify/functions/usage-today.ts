import type { Config } from "@netlify/functions";
import { planQuota } from "../../shared/contracts/plan-quota.js";
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

type QualityRpc = {
  day?: { consumed?: number; limit?: number; remaining?: number };
  month?: { consumed?: number; limit?: number; remaining?: number };
};

type FlyerWeeklyRpc = {
  successConsumed?: number;
  successLimit?: number;
  successRemaining?: number;
  triesConsumed?: number;
  triesLimit?: number;
  triesRemaining?: number;
  weekStartJst?: string;
};

function mergeFlyerWeeklyProjection(flyer: FlyerWeeklyRpc | undefined): {
  successConsumed: number;
  successLimit: 2;
  successRemaining: number;
  triesConsumed: number;
  triesLimit: 6;
  triesRemaining: number;
  weekStartJst: string;
} {
  const successLimit = planQuota.flyerWeekly.successPerJstWeek;
  const triesLimit = planQuota.flyerWeekly.triesPerJstWeek;
  // weekStartJst 欠落時は JST 月曜を Function で算出（RPC 障害時の wire 維持）
  const weekStartJst =
    typeof flyer?.weekStartJst === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(flyer.weekStartJst)
      ? flyer.weekStartJst
      : (() => {
          const now = new Date();
          const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
          const day = jst.getUTCDay(); // 0=Sun
          const mondayOffset = day === 0 ? -6 : 1 - day;
          jst.setUTCDate(jst.getUTCDate() + mondayOffset);
          return jst.toISOString().slice(0, 10);
        })();
  return {
    successConsumed: flyer?.successConsumed ?? 0,
    successLimit,
    successRemaining: flyer?.successRemaining ?? successLimit,
    triesConsumed: flyer?.triesConsumed ?? 0,
    triesLimit,
    triesRemaining: flyer?.triesRemaining ?? triesLimit,
    weekStartJst,
  };
}

/**
 * quality の consumed/remaining 片方欠落を balance（consumed+remaining=limit）へ閉じる。
 * G8: remaining 欠落で limit フル残に寄せると available 過大になるため、
 * - remaining 欠落 + consumed あり → remaining = limit - consumed
 * - 両方欠落 → 使い切り（consumed=limit, remaining=0）で fail-closed
 * 枠ロック値（3/20）自体は変えない。
 */
function projectQualityBucket(
  bucket: { consumed?: number; remaining?: number } | undefined,
  limit: number,
): { consumed: number; remaining: number } {
  const consumed = bucket?.consumed;
  const remaining = bucket?.remaining;
  if (consumed !== undefined && remaining !== undefined) {
    return { consumed, remaining };
  }
  if (consumed !== undefined) {
    return { consumed, remaining: Math.max(0, limit - consumed) };
  }
  if (remaining !== undefined) {
    return { consumed: Math.max(0, limit - remaining), remaining };
  }
  // 両方欠落: 残あり誤表示を避けて使い切り扱い
  return { consumed: limit, remaining: 0 };
}

/** RPC quality 投影 + plusEntitled から available を合成する */
function mergeQualityProjection(
  quality: QualityRpc | undefined,
  plusEntitled: boolean,
): {
  day: { consumed: number; limit: 3; remaining: number };
  month: { consumed: number; limit: 20; remaining: number };
  available: boolean;
} {
  const dayLimit = planQuota.quality.perDay;
  const monthLimit = planQuota.quality.perMonth;
  const day = projectQualityBucket(quality?.day, dayLimit);
  const month = projectQualityBucket(quality?.month, monthLimit);
  return {
    day: {
      consumed: day.consumed,
      limit: dayLimit,
      remaining: day.remaining,
    },
    month: {
      consumed: month.consumed,
      limit: monthLimit,
      remaining: month.remaining,
    },
    available: plusEntitled && day.remaining > 0 && month.remaining > 0,
  };
}

/**
 * 生成行を作らず、当日の成功 / 外部 attempt / 短期窓 / 全体受付 / 品質枠を返す。
 * 台帳への insert は行わない。
 * globalAvailable は予約側と同じ GLOBAL_DAILY_AI_LIMIT を渡して計算する。
 * identity 日次はサーバ計算の identity_key で読む（クライアント指定不可）。
 * plan / plusEntitled / quality.available は RPC に無く、entitlement から Function が merge する。
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
        quality?: QualityRpc;
        flyerWeekly?: FlyerWeeklyRpc;
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
        quality: mergeQualityProjection(
          {
            day: { consumed: 0, remaining: planQuota.quality.perDay },
            month: { consumed: 0, remaining: planQuota.quality.perMonth },
          },
          plusEntitled,
        ),
        flyerWeekly: mergeFlyerWeeklyProjection({
          successConsumed: 0,
          successRemaining: planQuota.flyerWeekly.successPerJstWeek,
          triesConsumed: 0,
          triesRemaining: planQuota.flyerWeekly.triesPerJstWeek,
          ...(typeof rpcBody.flyerWeekly?.weekStartJst === "string"
            ? { weekStartJst: rpcBody.flyerWeekly.weekStartJst }
            : {}),
        }),
        globalAvailable: rpcBody.globalAvailable === true,
        retryAt: rpcBody.globalAvailable === true ? null : (rpcBody.retryAt ?? null),
      });
      return json(200, { ok: true, data: projected });
    }

    const rpcBody =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown> & {
            quality?: QualityRpc;
            flyerWeekly?: FlyerWeeklyRpc;
          })
        : {};
    const merged = usageTodayDataSchema.parse({
      ...rpcBody,
      plan: quotaPlan,
      plusEntitled,
      quality: mergeQualityProjection(rpcBody.quality, plusEntitled),
      flyerWeekly: mergeFlyerWeeklyProjection(rpcBody.flyerWeekly),
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
