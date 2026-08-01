import { HttpError } from "./http.js";

/**
 * 運用ログの閉じた形。
 * 氏名・メール・アレルギー・プロンプト・生 AI 応答は決して出さない。
 * 許可フィールドのみを snake_case JSON で書き出す。
 *
 * 緊急献立フィールド（path / matchMode / emptyReason / candidateCount / mealType /
 * mainIngredientCount）は非PII の列挙・件数のみ。食材名・アレルギー本文は載せない。
 */
export type SafeLogEvent = {
  level: "info" | "warn" | "error";
  requestId: string;
  code: string;
  durationMs: number;
  modelId?: string;
  /** 時間メンテのみ — 集計件数。行 ID は出さない。 */
  staleReservationsFinalized?: number;
  generationLedgersDeleted?: number;
  shoppingMutationsDeleted?: number;
  authContinuationsDeleted?: number;
  userFeedbackDeleted?: number;
  draftSubmissionsDeleted?: number;
  /** identity / quality 台帳削除件数（行 ID は出さない） */
  identityLedgersDeleted?: number;
  /** flyer 台帳・終端 flyer request 削除件数 */
  flyerLedgersDeleted?: number;
  /** 共有 job reaper（lease_expired）件数。job 本文・ID は出さない */
  staleShareJobsReaped?: number;
  /** 緊急献立: household | idea */
  path?: "household" | "idea";
  /** 緊急献立: Stage M 結果。空応答は null */
  matchMode?: "none" | "main_ingredient" | "safety_only" | null;
  /** 緊急献立: 空理由。非空は null */
  emptyReason?: "current_safety_unavailable" | "no_matching_fixture" | null;
  /** 緊急献立: 返却候補件数（食材名・本文は出さない） */
  candidateCount?: number;
  /** 緊急献立: breakfast | lunch | dinner */
  mealType?: "breakfast" | "lunch" | "dinner";
  /** 緊急献立: メイン食材の件数のみ（名称は出さない） */
  mainIngredientCount?: number;
  // --- billing（M4）。email / receipt / name 等 PII は禁止 ---
  plan?: "free" | "plus";
  billingStatus?: string;
  priceInterval?: "month" | "year";
  qualityMode?: boolean;
  flyer?: boolean;
  /** opaque Stripe id のみ（cus_… / sub_…） */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** unmapped 等の集計カウンタ（本文は出さない） */
  alertMetric?: number;
  /**
   * 生成 HTTP 境界のルートテンプレ名のみ（ユーザー入力 path 断片は載せない）。
   * Observability / Function log で menu vs status を区別する。
   */
  generationRoute?: "menu" | "dish" | "status";
  /** 返却 HTTP ステータス（本文・PII は出さない） */
  httpStatus?: number;
};

type LogWriter = (serialized: string) => void;

export type SafeGenerationLogEvent = {
  requestId: string;
  errorCode: string;
  durationMs: number;
  modelId: string | null;
};

type SafeSink = Record<"info" | "warn" | "error", (line: string) => void>;

/** code 欄に自由文や例外 message を載せない（閉じた snake_case のみ） */
function closedErrorCode(raw: string): string {
  if (/^[a-z][a-z0-9_]{0,79}$/u.test(raw)) return raw;
  return "request_failed";
}

/**
 * 許可フィールドだけをシリアライズするロガーを返す。
 * 未定義の任意キーは無視され、JSON に混入しない。
 * code は closedErrorCode で閉じ、HTTP 境界以外の generation ログも free-text を載せない。
 */
export const createSafeLogger =
  (write: LogWriter = console.log) =>
  (event: SafeLogEvent): void => {
    // null は緊急献立の matchMode / emptyReason 用（省略と区別するため明示シリアライズ）
    const record: Record<string, string | number | null> = {
      level: event.level,
      request_id: event.requestId,
      code: closedErrorCode(event.code),
      duration_ms: Math.max(0, Math.trunc(event.durationMs)),
    };
    if (event.modelId !== undefined) record.model_id = event.modelId;
    if (event.staleReservationsFinalized !== undefined) {
      record.stale_reservations_finalized = event.staleReservationsFinalized;
    }
    if (event.generationLedgersDeleted !== undefined) {
      record.generation_ledgers_deleted = event.generationLedgersDeleted;
    }
    if (event.shoppingMutationsDeleted !== undefined) {
      record.shopping_mutations_deleted = event.shoppingMutationsDeleted;
    }
    if (event.authContinuationsDeleted !== undefined) {
      record.auth_continuations_deleted = event.authContinuationsDeleted;
    }
    if (event.userFeedbackDeleted !== undefined) {
      record.user_feedback_deleted = event.userFeedbackDeleted;
    }
    if (event.draftSubmissionsDeleted !== undefined) {
      record.draft_submissions_deleted = event.draftSubmissionsDeleted;
    }
    if (event.identityLedgersDeleted !== undefined) {
      record.identity_ledgers_deleted = event.identityLedgersDeleted;
    }
    if (event.flyerLedgersDeleted !== undefined) {
      record.flyer_ledgers_deleted = event.flyerLedgersDeleted;
    }
    if (event.staleShareJobsReaped !== undefined) {
      record.stale_share_jobs_reaped = event.staleShareJobsReaped;
    }
    // 緊急献立: 列挙・件数のみ。null も明示的に出す（省略すると集計が欠ける）
    if (event.path !== undefined) record.path = event.path;
    if (event.matchMode !== undefined) record.match_mode = event.matchMode;
    if (event.emptyReason !== undefined) record.empty_reason = event.emptyReason;
    if (event.candidateCount !== undefined) {
      record.candidate_count = Math.max(0, Math.trunc(event.candidateCount));
    }
    if (event.mealType !== undefined) record.meal_type = event.mealType;
    if (event.mainIngredientCount !== undefined) {
      record.main_ingredient_count = Math.max(0, Math.trunc(event.mainIngredientCount));
    }
    // billing: 非 PII の列挙・opaque id のみ
    if (event.plan !== undefined) record.plan = event.plan;
    if (event.billingStatus !== undefined) record.billing_status = event.billingStatus;
    if (event.priceInterval !== undefined) record.price_interval = event.priceInterval;
    if (event.qualityMode !== undefined) record.quality_mode = event.qualityMode ? 1 : 0;
    if (event.flyer !== undefined) record.flyer = event.flyer ? 1 : 0;
    if (event.stripeCustomerId !== undefined) {
      record.stripe_customer_id = event.stripeCustomerId;
    }
    if (event.stripeSubscriptionId !== undefined) {
      record.stripe_subscription_id = event.stripeSubscriptionId;
    }
    if (event.alertMetric !== undefined) {
      record.alert_metric = Math.max(0, Math.trunc(event.alertMetric));
    }
    if (event.generationRoute !== undefined) {
      record.generation_route = event.generationRoute;
    }
    if (event.httpStatus !== undefined) {
      record.http_status = Math.max(0, Math.trunc(event.httpStatus));
    }
    write(JSON.stringify(record));
  };

/** 本番 Functions の既定シンク（stdout 相当） */
export const safeLog = createSafeLogger();

export type GenerationHttpRoute = NonNullable<SafeLogEvent["generationRoute"]>;

/**
 * 生成 HTTP 境界の閉じた運用ログ（Function log / Observability 検索用）。
 * email・本文・prompt は出さない。correlationId は冪等キー UUID または handler 発行 UUID。
 */
export function logGenerationHttpBoundary(
  event: {
    route: GenerationHttpRoute;
    code: string;
    durationMs: number;
    correlationId: string;
    httpStatus: number;
    level?: SafeLogEvent["level"];
  },
  write: LogWriter = console.log,
): void {
  const httpStatus = Math.max(0, Math.trunc(event.httpStatus));
  const level = event.level ?? (httpStatus >= 500 ? "error" : httpStatus >= 400 ? "warn" : "info");
  createSafeLogger(write)({
    level,
    requestId: event.correlationId,
    code: closedErrorCode(event.code),
    durationMs: event.durationMs,
    generationRoute: event.route,
    httpStatus,
  });
}

/**
 * handleError 前後で閉じた HTTP 境界ログを残す（ok:false 経路）。
 * message 本文は出さない。code は HttpError.code または request_failed。
 */
export function handleGenerationHttpError(
  route: GenerationHttpRoute,
  error: unknown,
  input: {
    startedAtMonotonicMs: number;
    correlationId: string;
    handle: (error: unknown) => Response;
  },
  write: LogWriter = console.log,
): Response {
  const response = input.handle(error);
  const code = error instanceof HttpError ? error.code : "request_failed";
  logGenerationHttpBoundary(
    {
      route,
      code,
      durationMs: performance.now() - input.startedAtMonotonicMs,
      correlationId: input.correlationId,
      httpStatus: response.status,
    },
    write,
  );
  return response;
}

/**
 * Plan 3 互換ラッパ。errorCode → code、null modelId → 省略。
 * sink[level] へ振り、error は stderr 系シンクに残す。
 */
export function logGenerationEvent(
  level: "info" | "warn" | "error",
  event: SafeGenerationLogEvent,
  sink: SafeSink = console,
): void {
  const write: LogWriter = (serialized) => {
    sink[level](serialized);
  };
  createSafeLogger(write)({
    level,
    requestId: event.requestId,
    code: event.errorCode,
    durationMs: event.durationMs,
    ...(event.modelId === null ? {} : { modelId: event.modelId }),
  });
}
