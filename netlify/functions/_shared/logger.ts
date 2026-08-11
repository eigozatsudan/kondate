import { HttpError } from "./http.js";

/**
 * 運用ログの閉じた形。
 * 氏名・メール・アレルギー・プロンプト・生 AI 応答は決して出さない。
 * 許可フィールドのみを snake_case JSON で書き出す。
 *
 * 緊急献立フィールド（path / matchMode / emptyReason / candidateCount / mealType /
 * mainIngredientCount）は非PII の列挙・件数のみ。食材名・アレルギー本文は載せない。
 *
 * S1: 許可 string キーも実行時に形・長さ・列挙で閉じる。誤配線の free-text は
 * 省略または閉じたフォールバックへ潰し、ログへ載せない。
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
  /**
   * 共有一般化 job の opaque id（UUID）。
   * タイトル・プロンプト・menu_payload・contributor は載せない。
   */
  jobId?: string;
  /**
   * 共有 job の閉じた failure / skip コード（自由文禁止）。
   * log `code` はイベント種別、こちらは端末理由。
   */
  failureCode?: string;
  /**
   * 緊急候補の非PII ソース件数（Task 9 以降）。contributor / 本文は禁止。
   * シリアライズは fixture/community をフラット化する。
   */
  sourceCounts?: {
    fixture: number;
    community: number;
  };
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
 * 相関 ID / requestId。UUID・短い opaque トークンのみ。
 * 空白・@・日本語 free-text は拒否 → 必須フィールドはフォールバック。
 */
function closedRequestId(raw: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(raw)) return raw;
  return "invalid_request_id";
}

/**
 * OpenRouter model id 形（vendor/model:tag）。evidenceModelIdSchema と同趣旨。
 * free-text / メール混入は省略。
 */
function closedModelId(raw: string): string | undefined {
  if (raw.length >= 1 && raw.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(raw)) {
    return raw;
  }
  return undefined;
}

/** Stripe Subscription status の閉じた列挙。未知・free-text は省略。 */
const CLOSED_BILLING_STATUSES = new Set([
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

function closedBillingStatus(raw: string): string | undefined {
  if (CLOSED_BILLING_STATUSES.has(raw)) return raw;
  return undefined;
}

/** opaque Stripe customer id（cus_…）。プレフィックス外・空白・@ 混入は省略。 */
function closedStripeCustomerId(raw: string): string | undefined {
  // ローカル/テストも cus_test_delete_1 形。空白・記号 free-text は拒否。
  if (/^cus_[A-Za-z0-9_]{1,120}$/u.test(raw)) return raw;
  return undefined;
}

/** opaque Stripe subscription id（sub_…）。 */
function closedStripeSubscriptionId(raw: string): string | undefined {
  if (/^sub_[A-Za-z0-9_]{1,120}$/u.test(raw)) return raw;
  return undefined;
}

/** 共有 job の opaque UUID。形外は省略。 */
function closedJobId(raw: string): string | undefined {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(raw)) {
    return raw.toLowerCase();
  }
  return undefined;
}

/**
 * 許可フィールドだけをシリアライズするロガーを返す。
 * 未定義の任意キーは無視され、JSON に混入しない。
 * code / failureCode は closedErrorCode で閉じ、
 * その他の許可 string も形・列挙で閉じ（S1: free-text を載せない）。
 */
export const createSafeLogger =
  (write: LogWriter = console.log) =>
  (event: SafeLogEvent): void => {
    // null は緊急献立の matchMode / emptyReason 用（省略と区別するため明示シリアライズ）
    const record: Record<string, string | number | null> = {
      level: event.level,
      request_id: closedRequestId(event.requestId),
      code: closedErrorCode(event.code),
      duration_ms: Math.max(0, Math.trunc(event.durationMs)),
    };
    if (event.modelId !== undefined) {
      const modelId = closedModelId(event.modelId);
      if (modelId !== undefined) record.model_id = modelId;
    }
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
    // billing: 非 PII の列挙・opaque id のみ（値も実行時に閉じる）
    if (event.plan !== undefined) record.plan = event.plan;
    if (event.billingStatus !== undefined) {
      const billingStatus = closedBillingStatus(event.billingStatus);
      if (billingStatus !== undefined) record.billing_status = billingStatus;
    }
    if (event.priceInterval !== undefined) record.price_interval = event.priceInterval;
    if (event.qualityMode !== undefined) record.quality_mode = event.qualityMode ? 1 : 0;
    if (event.flyer !== undefined) record.flyer = event.flyer ? 1 : 0;
    if (event.stripeCustomerId !== undefined) {
      const stripeCustomerId = closedStripeCustomerId(event.stripeCustomerId);
      if (stripeCustomerId !== undefined) record.stripe_customer_id = stripeCustomerId;
    }
    if (event.stripeSubscriptionId !== undefined) {
      const stripeSubscriptionId = closedStripeSubscriptionId(event.stripeSubscriptionId);
      if (stripeSubscriptionId !== undefined) {
        record.stripe_subscription_id = stripeSubscriptionId;
      }
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
    // 共有 worker / 緊急: opaque id と閉じたコード・件数のみ（自由文キーは型で拒否）
    if (event.jobId !== undefined) {
      const jobId = closedJobId(event.jobId);
      if (jobId !== undefined) record.job_id = jobId;
    }
    if (event.failureCode !== undefined) {
      record.failure_code = closedErrorCode(event.failureCode);
    }
    if (event.sourceCounts !== undefined) {
      record.source_counts_fixture = Math.max(0, Math.trunc(event.sourceCounts.fixture));
      record.source_counts_community = Math.max(0, Math.trunc(event.sourceCounts.community));
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
