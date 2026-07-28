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
};

type LogWriter = (serialized: string) => void;

export type SafeGenerationLogEvent = {
  requestId: string;
  errorCode: string;
  durationMs: number;
  modelId: string | null;
};

type SafeSink = Record<"info" | "warn" | "error", (line: string) => void>;

/**
 * 許可フィールドだけをシリアライズするロガーを返す。
 * 未定義の任意キーは無視され、JSON に混入しない。
 */
export const createSafeLogger =
  (write: LogWriter = console.log) =>
  (event: SafeLogEvent): void => {
    // null は緊急献立の matchMode / emptyReason 用（省略と区別するため明示シリアライズ）
    const record: Record<string, string | number | null> = {
      level: event.level,
      request_id: event.requestId,
      code: event.code,
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
    write(JSON.stringify(record));
  };

/** 本番 Functions の既定シンク（stdout 相当） */
export const safeLog = createSafeLogger();

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
