/**
 * Netlify 同期 Function とアプリ予算のリリース固定値。
 * プラットフォーム硬上限は 60s・非設定。アプリは headroom を残して必ず内側に収める。
 * 変更は設計改訂 + env / preflight / generation-service 同時更新。
 *
 * 算術（repair 2 本を残す）:
 * - REQUIRED_SEND = OPENROUTER_TIMEOUT + FINALIZE_RESERVE = 24s + 2s = 26s
 * - primary 最大 24s 後 remaining ≥ 31s ≥ 26s → repair 可
 * - 2×24s + finalize 2s + RPC/overhead ≤ 55s（platform 60s の内側）
 */

/** Netlify 同期 Function のプラットフォーム硬上限（ms）。公式: 非設定の 60 秒。 */
export const NETLIFY_SYNC_FUNCTION_LIMIT_MS = 60_000;

/**
 * Function 総予算（ms）。
 * 60s 切断の前に応答返却・finalize 用 headroom（5s）を確保する。
 */
export const FUNCTION_TOTAL_BUDGET_MS = 55_000;

/**
 * OpenRouter 1 試行上限（ms）。
 * primary + 最大 1 repair が総予算内に収まるよう 24s（旧 60s は platform 60s と衝突）。
 */
export const OPENROUTER_TIMEOUT_MS = 24_000;

/** 最終化用に送信前に残す最小余裕（ms）。generation-service と一致。 */
export const FINALIZE_RESERVE_MS = 2_000;
