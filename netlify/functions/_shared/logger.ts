/**
 * 運用ログの閉じた形。
 * 氏名・メール・アレルギー・プロンプト・生 AI 応答は決して出さない。
 * 許可フィールドのみを snake_case JSON で書き出す。
 */
export type SafeLogEvent = {
  level: "info" | "warn" | "error";
  requestId: string;
  code: string;
  durationMs: number;
  modelId?: string;
  /** 時間メンテのみ — 集計件数4つ。行 ID は出さない。 */
  staleReservationsFinalized?: number;
  generationLedgersDeleted?: number;
  shoppingMutationsDeleted?: number;
  authContinuationsDeleted?: number;
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
    const record: Record<string, string | number> = {
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
