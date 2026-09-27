/**
 * Netlify 同期 Function とアプリ予算のリリース固定値。
 * 公式ドキュメントは同期 60s・非設定と書くが、本番 Free プランの実効上限は約 30s
 * （2026-09-27 本番 502 at 30.8s、関数ログなし）。アプリは Free の実効 30s の内側へ
 * headroom を残して収める。変更は設計改訂 + env / preflight / generation-service 同時更新。
 *
 * S1 / SC5: quota 由来の総予算・OpenRouter timeout の正本は plan-quota-constants.mjs。
 * プラットフォーム実効 30s・finalize 余裕・クライアント headroom は本ファイルの導出定数。
 *
 * 算術（Netlify Free 実効 30s に合わせて再ロック。repair はほぼ入らないトレードオフを許容）:
 * - REQUIRED_SEND = OPENROUTER_TIMEOUT + FINALIZE_RESERVE = 20s + 2s = 22s
 * - 送信前の準備（認証・予約・context 読み込み・Models 政策確認）は 26 − 22 = 4s 以内でないと
 *   pre-send ゲートで送らずに generation_timeout（attempt は焼かない）
 * - primary 1 回で最大 20s 使うと残り 6s（< 22s）のため repair は予算上ほぼ入らない（canRepair() が false）
 * - 26s 総予算 + finalize 2s ≤ 26s、+ client headroom 3s = 29s < 実効 30s
 */

import {
  FUNCTION_TOTAL_BUDGET_MS as functionTotalFromShared,
  OPENROUTER_TIMEOUT_MS as openRouterTimeoutFromShared,
} from "./plan-quota-constants.mjs";

/**
 * Netlify 同期 Function のプラットフォーム硬上限（ms）。
 * 公式ドキュメントは非設定の 60 秒と書くが、本番 Free プランでの実測は約 30 秒
 * （2026-09-27 本番 502 at 30.8s）。本番の実効値である 30s をここに固定する。
 */
export const NETLIFY_SYNC_FUNCTION_LIMIT_MS = 30_000;

/**
 * Function 総予算（ms）。
 * Free 実効 30s 切断の前に応答返却・finalize 用 headroom を確保する。
 * 正本: plan-quota-constants.mjs
 */
export const FUNCTION_TOTAL_BUDGET_MS = functionTotalFromShared;

/**
 * OpenRouter 1 試行上限（ms）。
 * Free 実効 30s の内側で primary が総予算内に収まるよう 20s（repair はほぼ入らない）。
 * 正本: plan-quota-constants.mjs
 */
export const OPENROUTER_TIMEOUT_MS = openRouterTimeoutFromShared;

/** 最終化用に送信前に残す最小余裕（ms）。generation-service と一致。 */
export const FINALIZE_RESERVE_MS = 2_000;

/**
 * 生成 POST のクライアント abort を総予算からどれだけ外側に置くか（ms）。
 * サーバ 26s と実効 platform 30s（Netlify Free 実測）の間に置き、hang 中に status poll へ戻れない窓を閉じる。
 */
export const GENERATION_CLIENT_TIMEOUT_HEADROOM_MS = 3_000;

/**
 * 生成 POST のクライアント abort 上限（ms）。
 * FUNCTION_TOTAL_BUDGET_MS + headroom から導出（S12: リテラルミラー禁止）。
 */
export const GENERATION_POST_CLIENT_TIMEOUT_MS =
  FUNCTION_TOTAL_BUDGET_MS + GENERATION_CLIENT_TIMEOUT_HEADROOM_MS;
