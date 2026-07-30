/**
 * チラシ→1 週間献立サービス。
 * reserve S0–S4 → mark sent → OpenRouter vision → Zod + server safety → finalize。
 * 画像・ファイル名はログしない（SafeLog flyer: true のみ）。
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  flyerWeeklyIssueMessages,
  weeklyFlyerMenuSchema,
  type WeeklyFlyerMenu,
  type WeeklyFlyerMenuResult,
} from "../../../shared/contracts/flyer-weekly.js";
import {
  FINALIZE_RESERVE_MS,
  OPENROUTER_TIMEOUT_MS,
} from "../../../shared/contracts/function-budget.js";
import { issueMessages } from "../../../shared/contracts/generation.js";
import { privacyNoticeVersion } from "../../../shared/contracts/domain.js";
import { planQuota } from "../../../shared/contracts/plan-quota.js";
import { normalizeFoodText } from "../../../shared/safety/allergens.js";
import {
  applyQuotaPlan,
  BillingEntitlementUnavailableError,
  limitsForPlan,
  loadEntitlement,
  productSurfacesOpen,
} from "./billing-entitlement.js";
import { loadCurrentSafetyContext } from "./current-safety.js";
import { getServerEnv } from "./env.js";
import { FlyerImageError, prepareFlyerImage } from "./flyer-image.js";
import { HttpError } from "./http.js";
import { safeLog } from "./logger.js";
import {
  createOpenRouterGenerationSender,
  OpenRouterCallError,
  type OpenRouterGenerationResult,
  type OpenRouterMessage,
} from "./openrouter.js";
import { computeQuotaIdentityKey } from "./quota-identity.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

/**
 * JST 週の月曜 YYYY-MM-DD。usage-today の flyer weekStart フォールバックと同式。
 * UTC toISOString の暦日は使わない（JST 深夜付近でずれる）。
 */
export function jstWeekStartMonday(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.getUTCDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  jst.setUTCDate(jst.getUTCDate() + mondayOffset);
  return jst.toISOString().slice(0, 10);
}

/**
 * 新 RPC を typegen 前に呼ぶ。migration 適用後は `npm run db:types` で正式型へ寄せる。
 */
async function rpcUntyped(
  admin: AdminSupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> {
  // typegen 前の新 RPC 呼び出し。await 後に data/error だけ読む。
  const result: unknown = await (
    admin as unknown as {
      rpc: (name: string, params: Record<string, unknown>) => Promise<unknown>;
    }
  ).rpc(fn, args);
  if (typeof result !== "object" || result === null) {
    return { data: null, error: { message: "rpc_failed" } };
  }
  const record = result as { data?: unknown; error?: { message?: string } | null };
  return { data: record.data ?? null, error: record.error ?? null };
}

const reservePayloadSchema = z.looseObject({
  request_id: z.uuid().nullable(),
  idempotency_key: z.string(),
  status: z.enum(["processing", "succeeded", "failed"]),
  failure_code: z.string().nullable().optional(),
  retry_at: z.string().nullable().optional(),
  week_start: z.string().optional(),
  result: z.unknown().nullable().optional(),
  replayed: z.boolean().optional(),
  flyer_try_sent: z.boolean().optional(),
  global_sent_calls: z.number().optional(),
});

const markPayloadSchema = z.looseObject({
  sent: z.boolean(),
  code: z.string().optional(),
  status: z.string().optional(),
  failure_code: z.string().nullable().optional(),
  retry_at: z.string().nullable().optional(),
});

export type FlyerWeeklyAuthUser = {
  userId: string;
  email: string;
  /** privacy_consents を user-scoped で読むための JWT */
  accessToken: string;
};

/** mark 前に必要な最小残り予算（試行上限 + finalize 予約）。generation-service と同型。 */
const REQUIRED_SEND_BUDGET_MS = OPENROUTER_TIMEOUT_MS + FINALIZE_RESERVE_MS;

const flyerConsentRowSchema = z
  .object({
    user_id: z.uuid(),
    notice_version: z.literal(privacyNoticeVersion),
    accepted_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type FlyerWeeklyDeps = {
  user: FlyerWeeklyAuthUser;
  /** テスト用: OpenRouter 呼び出し回数を数える */
  openRouterSender?: (
    messages: readonly OpenRouterMessage[],
    timeoutMs: number,
  ) => Promise<OpenRouterGenerationResult>;
  now?: () => Date;
  /** handler 入口の performance.now()。未指定時は本関数入口で計測する。 */
  requestStartedAtMonotonicMs?: number;
  /** 総予算 ms。既定はリリース固定 55s。 */
  functionTotalBudgetMs?: number;
  /** テスト用の単調時計。 */
  monotonicNow?: () => number;
  /**
   * テスト用: 現行 notice への同意確認を差し替え。
   * 未指定時は privacy_consents を user-scoped に読む（生成経路と同型）。
   */
  assertPrivacyConsent?: (user: FlyerWeeklyAuthUser) => Promise<void>;
};

/**
 * PRIV-1: チラシも OpenRouter へ送る AI 経路のため、現行 privacy_consents 必須。
 * reserve / 画像処理の前に fail-closed し、未同意で try を焼かない。
 */
export async function assertFlyerPrivacyConsent(user: FlyerWeeklyAuthUser): Promise<void> {
  const userClient = createUserScopedSupabase(user.accessToken);
  const consentResult = await userClient
    .from("privacy_consents")
    .select("user_id,notice_version,accepted_at")
    .eq("user_id", user.userId)
    .eq("notice_version", privacyNoticeVersion)
    .maybeSingle();
  const consent = flyerConsentRowSchema.safeParse(consentResult.data);
  if (consentResult.error !== null || !consent.success || consent.data.user_id !== user.userId) {
    throw new HttpError(422, "consent_required", "最新の利用説明への同意が必要です。");
  }
}

function entitlementUnavailableHttpError(): HttpError {
  return new HttpError(
    503,
    "billing_entitlement_unavailable",
    "プラン情報を確認できませんでした。しばらくしてからお試しください。",
  );
}

function mapFailureHttp(code: string, retryAt: string | null = null): never {
  const flyerKey = code as keyof typeof flyerWeeklyIssueMessages;
  const genKey = code as keyof typeof issueMessages;
  const flyerMsg =
    flyerKey in flyerWeeklyIssueMessages ? flyerWeeklyIssueMessages[flyerKey] : undefined;
  const genMsg = genKey in issueMessages ? issueMessages[genKey] : undefined;
  const message = flyerMsg ?? genMsg ?? "チラシ献立を作成できませんでした。";
  const status =
    code === "flyer_requires_plus"
      ? 403
      : code === "flyer_invalid_image" ||
          code === "flyer_unsupported_media" ||
          code === "flyer_invalid_ai_response" ||
          code === "invalid_request"
        ? 400
        : code === "flyer_weekly_limit" ||
            code === "flyer_weekly_try_limit" ||
            code === "user_attempt_limit" ||
            code === "user_short_window_limit" ||
            code === "global_daily_limit"
          ? 429
          : code === "model_unavailable" || code === "generation_timeout"
            ? 503
            : 400;
  throw new HttpError(status, code, message, retryAt ? { retryAt } : undefined);
}

/**
 * 表示・保持フィールド全体が現行 safety の禁止アレルゲンに触れていないか（全通 or fail）。
 * label / notes も検査対象。NFKC・全角・zero-width 等は normalizeFoodText で寄せる。
 */
export function assertFlyerMenuSafe(
  menu: WeeklyFlyerMenu,
  bannedIngredientNeedles: readonly string[],
): void {
  if (bannedIngredientNeedles.length === 0) return;
  const needles = bannedIngredientNeedles
    .map((n) => normalizeFoodText(n))
    .filter((n) => n.length > 0);
  if (needles.length === 0) return;

  for (const day of menu.days) {
    // UI に出る可能性のある全フィールドを検査（main/side/ingredients だけだと provider が回避できる）
    const corpus = normalizeFoodText(
      [day.label, day.mainName, day.sideName ?? "", day.notes ?? "", ...day.ingredients].join(" "),
    );
    for (const needle of needles) {
      if (corpus.includes(needle)) {
        throw new HttpError(
          400,
          "flyer_invalid_ai_response",
          flyerWeeklyIssueMessages.flyer_invalid_ai_response,
        );
      }
    }
  }
}

function buildFlyerMessages(dataUrl: string): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content:
        "あなたは家庭の週間献立アシスタントです。スーパーのチラシ写真から、主菜中心の 7 日分献立を JSON で返してください。" +
        "days は dayIndex 1..7 を一意に含み、各日 mainName と ingredients（食材名の配列）を必ず入れてください。" +
        "アレルギー・医療・離乳食は扱わず、一般的な家庭料理に限定してください。",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "このチラシ写真を見て、1 週間（7 日）の献立案を JSON で作ってください。",
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];
}

/**
 * multipart の image フィールドのみを受け取り、週間献立を返す。
 */
export async function runFlyerWeekly(
  deps: FlyerWeeklyDeps,
  imageBytes: Uint8Array,
  idempotencyKey: string = randomUUID(),
): Promise<{ menu: WeeklyFlyerMenuResult; requestId: string }> {
  const env = getServerEnv();
  const startedAtMonotonicMs = deps.requestStartedAtMonotonicMs ?? performance.now();
  const functionTotalBudgetMs = deps.functionTotalBudgetMs ?? env.openRouter.functionTotalBudgetMs;
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  const remainingMs = (): number =>
    Math.max(0, Math.trunc(startedAtMonotonicMs + functionTotalBudgetMs - monotonicNow()));
  // ログ duration は handler 相対の経過時間
  const started = startedAtMonotonicMs;
  const requestIdForLog = randomUUID();
  let openRouterCalls = 0;

  let entitlement;
  try {
    entitlement = await loadEntitlement(deps.user.userId);
  } catch (error: unknown) {
    if (error instanceof BillingEntitlementUnavailableError || error instanceof HttpError) {
      throw entitlementUnavailableHttpError();
    }
    throw entitlementUnavailableHttpError();
  }

  // Free / kill switch: reserve 前 403（台帳非接触）
  if (!productSurfacesOpen(env.billingEnabled) || !entitlement.plusEntitled) {
    safeLog({
      level: "info",
      requestId: requestIdForLog,
      code: "flyer_requires_plus",
      durationMs: performance.now() - started,
      flyer: true,
      plan: "free",
    });
    throw new HttpError(403, "flyer_requires_plus", flyerWeeklyIssueMessages.flyer_requires_plus);
  }

  const quotaPlan = applyQuotaPlan(entitlement, env.billingEnabled);
  if (quotaPlan !== "plus") {
    throw new HttpError(403, "flyer_requires_plus", flyerWeeklyIssueMessages.flyer_requires_plus);
  }

  // PRIV-1: Plus でも未同意なら AI 送信しない（生成・再生成と同型）。OpenRouter 0 回。
  const assertConsent = deps.assertPrivacyConsent ?? assertFlyerPrivacyConsent;
  await assertConsent(deps.user);

  // 画像は reserve 前に検証（失敗で try を焼かない）
  let prepared;
  try {
    prepared = await prepareFlyerImage(imageBytes);
  } catch (error: unknown) {
    if (error instanceof FlyerImageError) {
      mapFailureHttp(error.code);
    }
    mapFailureHttp("flyer_invalid_image");
  }

  const limits = limitsForPlan("plus");
  const identityKey = computeQuotaIdentityKey(env.quotaIdentityHmacKey, deps.user.email);
  const admin = getSupabaseAdmin();

  const { data: reserveRaw, error: reserveError } = await rpcUntyped(
    admin,
    "reserve_flyer_weekly",
    {
      p_user_id: deps.user.userId,
      p_identity_key: identityKey,
      p_idempotency_key: idempotencyKey,
      p_attempt_limit: limits.attemptsPerDay,
      p_short_window_limit: limits.shortWindowLimit,
      p_global_limit: env.openRouter.globalDailyLimit,
      p_quota_disabled: env.aiQuotaDisabled,
    },
  );
  if (reserveError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  const reserve = reservePayloadSchema.parse(reserveRaw);
  if (reserve.status === "failed") {
    const code = reserve.failure_code ?? "internal_error";
    if (code === "flyer_weekly_limit") {
      // A11: OpenRouter 0 回
      safeLog({
        level: "info",
        requestId: requestIdForLog,
        code: "flyer_weekly_limit",
        durationMs: performance.now() - started,
        flyer: true,
        plan: "plus",
      });
    }
    mapFailureHttp(code, reserve.retry_at ?? null);
  }

  if (reserve.status === "succeeded" && reserve.result != null) {
    const menu = weeklyFlyerMenuSchema.parse(reserve.result) as WeeklyFlyerMenuResult;
    return { menu, requestId: reserve.request_id ?? requestIdForLog };
  }

  const requestId = reserve.request_id;
  if (requestId == null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  // mark 前に 24s+2s の残りが無ければ sent 化せず timeout（generation-service と同契約）
  if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: false,
    });
    mapFailureHttp("generation_timeout");
  }

  // mark sent（short + try→sent + attempt/global）
  const { data: markRaw, error: markError } = await rpcUntyped(admin, "mark_flyer_weekly_sent", {
    p_request_id: requestId,
  });
  if (markError !== null) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "internal_error",
      p_sent: false,
    });
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const mark = markPayloadSchema.parse(markRaw);
  if (!mark.sent) {
    const code = mark.code ?? mark.failure_code ?? "user_short_window_limit";
    mapFailureHttp(code, mark.retry_at ?? null);
  }

  const flyerModels =
    env.openRouter.flyerModels.length > 0 ? env.openRouter.flyerModels : env.openRouter.plusModels;
  if (flyerModels.length === 0) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "model_unavailable",
      p_sent: true,
    });
    mapFailureHttp("model_unavailable");
  }

  const sender =
    deps.openRouterSender ??
    (async (messages, timeoutMs) => {
      const send = createOpenRouterGenerationSender({
        apiKey: env.openRouter.apiKey,
        baseUrl: env.openRouter.baseUrl,
        models: flyerModels,
        timeoutMs: env.openRouter.timeoutMs,
      });
      return send({ messages, timeoutMs, mode: "flyer_weekly" });
    });

  // 試行 timeout は 24s と「残り − finalize 予約」の小さい方
  const attemptTimeoutMs = Math.min(
    env.openRouter.timeoutMs,
    Math.max(0, remainingMs() - FINALIZE_RESERVE_MS),
  );
  if (attemptTimeoutMs <= 0) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: true,
    });
    mapFailureHttp("generation_timeout");
  }

  let aiResult: OpenRouterGenerationResult;
  try {
    openRouterCalls += 1;
    aiResult = await sender(buildFlyerMessages(prepared.dataUrl), attemptTimeoutMs);
  } catch (error: unknown) {
    const code = error instanceof OpenRouterCallError ? error.code : "model_unavailable";
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: code === "invalid_ai_response" ? "flyer_invalid_ai_response" : code,
      p_sent: true,
    });
    if (code === "invalid_ai_response") {
      mapFailureHttp("flyer_invalid_ai_response");
    }
    mapFailureHttp(code);
  }

  if (aiResult.mode !== "flyer_weekly") {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  const parsedMenu = weeklyFlyerMenuSchema.safeParse(aiResult.output);
  if (!parsedMenu.success) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  // server current safety only（クライアント allergy は信頼しない）
  try {
    // 世帯の全メンバー ID をサーバ側で読み、current safety を組み立てる
    const { data: memberRows, error: memberError } = await admin
      .from("household_members")
      .select("id")
      .eq("user_id", deps.user.userId)
      .eq("status", "complete")
      .order("sort_order", { ascending: true });
    if (memberError !== null) {
      throw new HttpError(
        400,
        "flyer_invalid_ai_response",
        flyerWeeklyIssueMessages.flyer_invalid_ai_response,
      );
    }
    const memberIds = (Array.isArray(memberRows) ? memberRows : []).map(
      (row: { id: string }) => row.id,
    );
    // メンバー 0 人（idea 世帯）でも Zod 通過後の構造は受理。banned は空。
    if (memberIds.length > 0) {
      const safety = await loadCurrentSafetyContext(admin, deps.user.userId, memberIds);
      const banned: string[] = [];
      const catalogById = new Map(
        safety.allergenDictionary.catalog.map((entry) => [entry.id, entry.displayName] as const),
      );
      for (const member of safety.members) {
        for (const allergenId of member.allergenIds) {
          const display = catalogById.get(allergenId);
          if (display) banned.push(display);
          for (const alias of safety.allergenDictionary.aliases) {
            if (alias.allergenId === allergenId) banned.push(alias.alias);
          }
        }
        for (const custom of member.customAllergies) {
          banned.push(custom.name);
          for (const alias of custom.aliases) banned.push(alias);
        }
      }
      assertFlyerMenuSafe(parsedMenu.data, banned);
    }
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
        p_request_id: requestId,
        p_failure_code: error.code,
        p_sent: true,
      });
      throw error;
    }
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  // reserve / model 欠落時も UTC 暦ではなく JST 月曜（usage-today と同アルゴリズム）
  const weekStart =
    typeof reserve.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(reserve.week_start)
      ? reserve.week_start
      : (parsedMenu.data.weekStartJst ?? jstWeekStartMonday(new Date()));

  const resultMenu: WeeklyFlyerMenuResult = {
    ...parsedMenu.data,
    weekStartJst: weekStart,
  };

  const { error: finError } = await rpcUntyped(admin, "finalize_flyer_weekly_success", {
    p_request_id: requestId,
    p_result: resultMenu,
  });
  if (finError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  safeLog({
    level: "info",
    requestId,
    code: "flyer_weekly_succeeded",
    durationMs: performance.now() - started,
    flyer: true,
    plan: "plus",
    modelId: aiResult.modelId,
  });

  // openRouterCalls はテストから deps 経由で観測（A11 は limit 経路で 0）
  void openRouterCalls;
  void planQuota;

  return { menu: resultMenu, requestId };
}

/** テスト用: reserve が flyer_weekly_limit のとき OpenRouter を呼ばないこと */
export async function runFlyerWeeklyWithReserveStub(options: {
  reserveResult: unknown;
  openRouterSender: (
    messages: readonly OpenRouterMessage[],
    timeoutMs: number,
  ) => Promise<OpenRouterGenerationResult>;
  plusEntitled: boolean;
  billingEnabled: boolean;
  /** 未指定は同意済み扱い。false で consent_required を再現する。 */
  hasPrivacyConsent?: boolean;
}): Promise<{ openRouterCalls: number; errorCode?: string }> {
  let openRouterCalls = 0;
  if (!options.billingEnabled || !options.plusEntitled) {
    return { openRouterCalls: 0, errorCode: "flyer_requires_plus" };
  }
  // PRIV-1: Plus でも未同意なら OpenRouter に触れない
  if (options.hasPrivacyConsent === false) {
    return { openRouterCalls: 0, errorCode: "consent_required" };
  }
  const reserve = reservePayloadSchema.parse(options.reserveResult);
  if (reserve.status === "failed" && reserve.failure_code === "flyer_weekly_limit") {
    return { openRouterCalls: 0, errorCode: "flyer_weekly_limit" };
  }
  openRouterCalls += 1;
  await options.openRouterSender([], 1000);
  return { openRouterCalls };
}
