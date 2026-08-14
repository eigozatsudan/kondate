/**
 * planQuota / function-budget / preflight / env が共有するリリース固定値の単一正本（S1）。
 *
 * - 製品数値そのものの無断変更は禁止。引き上げ時はここ + 依存コメント/テストを同時改訂。
 * - SQL whitelist（p_user_limit ∈ {3,10} 等）は dual-write 残差。本ファイルを変えても SQL は自動追随しない。
 * - TS plan-quota / function-budget と mjs preflight が同一 import で drift を閉じる。
 */

/** アプリ全体 AI 日次枠の製品 max（GLOBAL_DAILY_AI_LIMIT の上限）。 */
export const GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX = 500;

/** Free 日次成功枠（USER_DAILY_AI_LIMIT）。 */
export const FREE_SUCCESS_PER_DAY = 3;
export const FREE_SUCCESS_PER_DAY_ENV = "3";

/** Free 日次外部試行枠（USER_DAILY_EXTERNAL_CALL_LIMIT）。 */
export const FREE_ATTEMPTS_PER_DAY = 6;
export const FREE_ATTEMPTS_PER_DAY_ENV = "6";

/** Free 短時間窓の件数（USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT）。 */
export const FREE_SHORT_WINDOW_LIMIT = 4;
export const FREE_SHORT_WINDOW_LIMIT_ENV = "4";

/** Free/Plus 共通の短時間窓秒（USER_SHORT_WINDOW_SECONDS）。 */
export const FREE_SHORT_WINDOW_SECONDS = 600;
export const FREE_SHORT_WINDOW_SECONDS_ENV = "600";

/** OpenRouter 1 試行上限 ms（OPENROUTER_TIMEOUT_MS）。function-budget と同値。 */
export const OPENROUTER_TIMEOUT_MS = 24_000;
export const OPENROUTER_TIMEOUT_MS_ENV = "24000";

/** Function 総予算 ms（FUNCTION_TOTAL_BUDGET_MS）。function-budget と同値。 */
export const FUNCTION_TOTAL_BUDGET_MS = 55_000;
export const FUNCTION_TOTAL_BUDGET_MS_ENV = "55000";

/** processing 孤児解放までの秒（AI_PROCESSING_STALE_SECONDS）。 */
export const AI_PROCESSING_STALE_SECONDS = 180;
export const AI_PROCESSING_STALE_SECONDS_ENV = "180";
